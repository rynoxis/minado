const cluster = require('cluster')
const jayson = require('jayson')
const web3utils = require('web3-utils')

const peerUtils = require('./peer-utils')

const UPDATE_VAR_DIFF_PERIOD = 30 * 1000 // 30 seconds
const SOLUTION_FINDING_BONUS = 10.0

var varDiffPeriodCount = 0
var PROCESS_DIFFICULTY = false // false means vardiff

module.exports = {
    async init(
        web3,
        accountConfig,
        poolConfig,
        redisInterface,
        tokenInterface,
        pool_env
    ) {
        this.web3           = web3
        this.accountConfig  = accountConfig
        this.poolConfig     = poolConfig
        this.redisInterface = redisInterface
        this.tokenInterface = tokenInterface
        this.pool_env       = pool_env

        if (this.poolConfig.poolTokenFee === null) {
            console.error(
                'Please set a poolTokenFee (% of tokens as a pool fee)')

            /* Exit application */
            return exit()
        }

        console.log('Peer Interface initialization complete.')
    },
    async listenForJSONRPC(port) {
        this.initJSONRPCServer(port)
    },
    async update() {
        /* Localize this. */
        const self = this

        setTimeout(function () {
            self.processQueuedShares()
        }, 40)

        if (cluster.isMaster) {
            console.log('\nCLUSTER IS MASTER!')

            setTimeout(function () {
                self.monitorMinedSolutions()
            }, 1000)
        }

        setTimeout(function () {
            self.updateVariableDifficultyPeriod()
        }, 30 * 1000)
    },
    getPoolMinimumShareDifficulty() {
        return this.poolConfig.minimumShareDifficulty
    },
    async getMinerVarDiff(minerEthAddress) {
        if (PROCESS_DIFFICULTY) {
            return PROCESS_DIFFICULTY
        }

        if (
            minerEthAddress === null ||
            typeof minerEthAddress === 'undefined' ||
            !web3utils.isAddress(minerEthAddress)
        ) {
            const poolMinDiff = this.getPoolMinimumShareDifficulty()

            return poolMinDiff
        }

        const minerData = await this.loadMinerDataFromRedis(minerEthAddress)

        let varDiff = minerData.varDiff

        if (varDiff < this.getPoolMinimumShareDifficulty()) {
            varDiff = this.getPoolMinimumShareDifficulty()
        }

        return varDiff
    },
    /**
     * Get Pool Minimum Share Target
     */
    _getPoolMinimumShareTarget(_diff) {
        if (typeof _diff === 'undefined') {
            _diff = this.getPoolMinimumShareDifficulty()
        }

        return this.getTargetFromDifficulty(_diff)
    },
    getTargetFromDifficulty(difficulty) {
        let max_target = null

        // NOTE: Bitcoin uses `2**224`.
        if (this.pool_env === 'test') {
            max_target = web3utils.toBN(2).pow(web3utils.toBN(244))
        } else {
            max_target = web3utils.toBN(2).pow(web3utils.toBN(234))
        }
        // max_target = web3utils.toBN(2).pow(web3utils.toBN(234))

        const current_target = max_target.div(web3utils.toBN(difficulty))

        return current_target
    },
    /*
    This is the gatekeeper for solution submits
    */
    async handlePeerShareSubmit(
        nonce,
        minerEthAddress,
        challengeNumber,
        digest,
        difficulty
    ) {
        // console.log('\n')
        // console.log('---- received peer share submit -----')
        // console.log('nonce', nonce)
        // console.log('challengeNumber', challengeNumber)
        // console.log('minerEthAddress', minerEthAddress)
        // console.log('digest', digest)
        // console.log('difficulty', difficulty)
        // console.log('\n')

        if (difficulty === null) return
        if (nonce === null) return
        if (minerEthAddress === null) return
        if (challengeNumber === null) return
        if (digest === null) return

        const poolHelperEthAddress = this.getMintingAccount().address

        const poolChallengeNumber = await this.tokenInterface
            .getPoolChallengeNumber()

        const computed_digest = web3utils.soliditySha3(
            poolChallengeNumber,
            poolHelperEthAddress,
            nonce
        )

        const digestBytes32 = web3utils.hexToBytes(computed_digest)

        const digestBigNumber = web3utils.toBN(computed_digest)

        const minShareTarget = web3utils.toBN(
            this._getPoolMinimumShareTarget())

        const miningTarget = web3utils.toBN(
            await this.tokenInterface.getPoolDifficultyTarget())

        const claimedTarget = this.getTargetFromDifficulty(difficulty)

        const varDiff = await this.getMinerVarDiff(minerEthAddress)

        const usingCustomDifficulty = (difficulty !== varDiff)

        const minShareDifficulty = this.getPoolMinimumShareDifficulty()

        if (computed_digest === digest &&
            difficulty >= minShareDifficulty &&
            digestBigNumber.lt(claimedTarget)
        ) {
            const shareIsASolution = digestBigNumber.lt(miningTarget)

            return await this.handleValidShare(
                nonce,
                minerEthAddress,
                digest,
                difficulty,
                shareIsASolution,
                usingCustomDifficulty
            )
        } else {
            //console.log(minerEthAddress)

            /* Set ETH block number. */
            const block = await this.redisInterface.getEthBlockNumber()

            const shareData = {
                block, nonce,
                miner: minerEthAddress,
                difficulty,
                time: peerUtils.getUnixTimeNow()
            }

            await this.redisInterface.pushToRedisList(
                'miner_invalid_share:' + minerEthAddress.toString(),
                JSON.stringify(shareData)
            )

            return {
                success: false,
                message: 'This share digest is invalid'
            }
        }
    },
    async handleValidShare(
        nonce,
        minerEthAddress,
        digest,
        difficulty,
        shareIsASolution,
        usingCustomDifficulty
    ) {
        //console.log('handle valid share ')
        const existingShare = await this.redisInterface.findHashInRedis(
            'submitted_share', digest)

        //make sure we have never gotten this digest before (redis )
        if (existingShare === null) {
            //console.log('handle valid new share ')
            var block = await this.redisInterface.getEthBlockNumber()
            var minerData = await this.loadMinerDataFromRedis(minerEthAddress)

            minerData.usingCustomDifficulty = usingCustomDifficulty

            await this.saveMinerDataToRedis(minerEthAddress,minerData)

            let timeToFindShare = null

            if (minerData.lastSubmittedSolutionTime != null) {
                timeToFindShare =
                    (peerUtils.getUnixTimeNow() - minerData.lastSubmittedSolutionTime)
            } else {
                //make sure we check for this later
                timeToFindShare = 0
            }

            const shareData = {
                block            : block,
                nonce            : nonce,
                miner            : minerEthAddress,
                difficulty       : difficulty,
                isSolution       : shareIsASolution,
                hashRateEstimate : this.getEstimatedShareHashrate(difficulty, timeToFindShare),
                time             : peerUtils.getUnixTimeNow(),
                timeToFind       : timeToFindShare  //helps estimate hashrate- look at recent shares
            }

            //make sure this is threadsafe
            await this.redisInterface.storeRedisHashData(
                'submitted_share',
                digest,
                JSON.stringify(shareData)
            )

            await this.redisInterface.pushToRedisList(
                'miner_submitted_share:' + minerEthAddress.toString(),
                JSON.stringify(shareData)
            )

            await this.redisInterface.pushToRedisList(
                'submitted_shares_list',
                JSON.stringify(shareData)
            )

            if (shareIsASolution) {
                await this.redisInterface.pushToRedisList(
                    'submitted_solutions_list',
                    JSON.stringify(shareData)
                )
            }

            const shareCredits = await this.getShareCreditsFromDifficulty(
                difficulty, shareIsASolution)

            await this.awardShareCredits(minerEthAddress, shareCredits)

            // WARNING!! GIANT ISSUE IF AWAIT IS MISSING
            // TODO Research problem for improved solution
            const challengeNumber = await this.tokenInterface
                .getPoolChallengeNumber()

            if (shareIsASolution) {
                this.tokenInterface.queueMiningSolution(
                    nonce,
                    minerEthAddress,
                    digest,
                    challengeNumber
                )
            } else {
                //console.log('share is not a solution! ')
            }

            return {
                success: true,
                message: 'New share credited successfully'
            }
        } else {
            return {
                success: false,
                message: 'This share digest was already received'
            }
        }
    },
    //also update hashrate
    async updateVariableDifficultyPeriod() {
        /* Localize this. */
        const self = this

        const minerList = await this.getMinerList()

        for (let i in minerList) { // reward each miner
            const minerAddress = minerList[i]

            const minerData = await this.getMinerData(minerAddress)

            try {
                minerData.hashRate = await this.estimateMinerHashrate(minerAddress)

                await this.saveMinerDataToRedis(minerAddress, minerData)
            } catch (e) {}
        }

        varDiffPeriodCount++

        //  setTimeout(function(){self.updateVariableDifficultyPeriod()},4000  )///perform after booting

        setTimeout(
            function () {
                self.updateVariableDifficultyPeriod()
            }, UPDATE_VAR_DIFF_PERIOD
        ) // 1 minute
    },
    //TimeToSolveBlock (seconds) = difficulty * 2^22 / hashrate (hashes per second)

    /**
     * Get Estimated Share Hashrate
     *
     * hashrate = (difficulty * 2^22) / timeToSolveABlock seconds)
     */
    getEstimatedShareHashrate(difficulty, timeToFindSeconds ) {
        /* Set multiplier. */
        const multiplier = web3utils.toBN(2).pow(web3utils.toBN(22))

        if (timeToFindSeconds !== null && timeToFindSeconds > 0) {
            const hashrate = web3utils
                .toBN(difficulty)
                .mul(multiplier)
                .div(web3utils.toBN(timeToFindSeconds))

            return hashrate.toNumber() // hashes per second
        } else {
            return 0
        }
    },
    async estimateMinerHashrate(minerAddress) {
        try {
            var submitted_shares = await this.redisInterface
                .getParsedElementsOfListInRedis(
                    ('miner_submitted_share:' + minerAddress.toString()),
                    20
                )

            if (submitted_shares == null || submitted_shares.length < 1) {
                return 0
            }

            var totalDiff = 0
            var CUTOFF_MINUTES = 90
            var cutoff = peerUtils.getUnixTimeNow() - (CUTOFF_MINUTES * 60)

            // the most recent share seems to be at the front of the list
            var recentShareCount = 0

            while (
                recentShareCount < submitted_shares.length &&
                submitted_shares[recentShareCount].time > cutoff
            ) {
                if (isNaN(submitted_shares[recentShareCount].difficulty)) {
                    continue
                }

                totalDiff += submitted_shares[recentShareCount].difficulty
                recentShareCount++
            }

            if (isNaN(totalDiff) || recentShareCount === 0) {
                return 0
            }

            var seconds = submitted_shares[0].time - submitted_shares[recentShareCount - 1].time

            if (seconds === 0) {
                return 0
            }

            var hashrate = this.getEstimatedShareHashrate(totalDiff, seconds)

            return hashrate.toString()
        } catch (err) {
            console.log('Error in peer-interface::estimateMinerHashrate:', err)

            return 0
        }
    },
    //timeToFind
    async getAverageSolutionTime(minerAddress) {
        var submitted_shares =  await this.redisInterface.getRecentElementsOfListInRedis(('miner_submitted_share:'+minerAddress.toString()), 3)

        var sharesCount = 0;

        if (submitted_shares == null || submitted_shares.length < 1) {
            return null;
        }

        var summedFindingTime  = 0;

        for (var i = 0; i < submitted_shares.length; i++) {
            var share = submitted_shares[i]

            var findingTime = parseInt(share.timeToFind)

            if (!isNaN(findingTime) && findingTime> 0 && findingTime != null) {
                summedFindingTime += findingTime;
                sharesCount++;
            }
        }

        if (sharesCount <= 0) {
            return null
        }

        var timeToFind = Math.floor(summedFindingTime / sharesCount)

        return timeToFind
    },
    // we expect a solution per minute ??
    async getUpdatedVarDiffForMiner(minerData, minerAddress) {
        const minerVarDiff = minerData.varDiff
        const poolMinDiff = this.getPoolMinimumShareDifficulty()
        const avgFindingTime = await this.getAverageSolutionTime(minerAddress)

        // dont modify if using custom
        if (minerData.usingCustomDifficulty) {
            return minerVarDiff
        }

        minerData.avgFindingTime = avgFindingTime

        const expectedFindingTime = 60 // seconds

        if (minerData.validSubmittedSolutionsCount > 0 && avgFindingTime !== null) {
            if (avgFindingTime < expectedFindingTime * 0.9) {
                minerVarDiff = Math.ceil(minerVarDiff * 1.2) // harder
            } else if (avgFindingTime > expectedFindingTime * 1.1) {
                minerVarDiff = Math.ceil(minerVarDiff / 1.2) // easier
            }
        }

        return 64
        // return 65536

        if (PROCESS_DIFFICULTY) {
            return PROCESS_DIFFICULTY
        }

        if (minerVarDiff < poolMinDiff) {
            minerVarDiff = poolMinDiff
        }

        const MAX_VARDIFF = 2**16 // 65536
        // var MAX_VARDIFF = 12 * 1024;
        const MIN_DIFF = 2**6 // 64
        // var MIN_DIFF = 1024;

        if (minerVarDiff > MAX_VARDIFF) {
            minerVarDiff = MAX_VARDIFF
        }

        if (minerVarDiff < MIN_DIFF) {
            minerVarDiff = MIN_DIFF
        }

        return minerVarDiff
    },
    async processQueuedShares() {
        /* Localize this. */
        const self = this

        const shareDataJSON = await this.redisInterface.popFirstFromRedisList(
            'queued_shares_list')

        const shareData = JSON.parse(shareDataJSON)

        if (typeof shareData !== 'undefined' && shareData !== null) {
            try {
                const response = await self.handlePeerShareSubmit(
                    shareData.nonce,
                    shareData.minerEthAddress,
                    shareData.challengeNumber,
                    shareData.digest,
                    shareData.difficulty
                    // 65536
                )
            } catch (err) {
                console.log('ERROR: Handle share:', err)
            }
        }

        // NOTE: This loop will run as fast as possible.
        setTimeout(
            function () {
                self.processQueuedShares()
            }, 0
        )
    },
    async cleanRedisData() {
        //
    },
    async monitorMinedSolutions() {
        /* Localize this. */
        const self = this

        try {
            //console.log('monitor mined solutions ')
            const solution_txes = await this.redisInterface
                .getResultsOfKeyInRedis('unconfirmed_submitted_solution_tx')

            if (solution_txes !== null && solution_txes.length > 0) {
                await this.checkMinedSolutions(solution_txes)
            }
        } catch (e) {
            console.log('error', e)
        }

        setTimeout(function () {
            self.monitorMinedSolutions()
        }, 4000)
    },
    // resendUnbroadcastedPayments()
    async monitorMinedPayments() {
        return

        /* Localize this. */
        const self = this

        try {
            /*
            await this.redisInterface.storeRedisHashData('broadcasted_payment' ,balancePaymentId.toString(),JSON.stringify(broadcastedPaymentData) )
            await this.redisInterface.pushToRedisList(('broadcasted_payments'), JSON.stringify(broadcastedPaymentData)  )
            await this.redisInterface.pushToRedisList(('unconfirmed_broadcasted_payments'), JSON.stringify(broadcastedPaymentData)  )
            */

            // console.log('monitor mined payments ')
            const balance_xfers = await this.redisInterface.getResultsOfKeyInRedis(
                'balance_payment')

            if (balance_xfers !== null && balance_xfers.length > 0) {
                await this.checkMinedPayments(balance_xfers)
            }
        } catch (e) {
            console.log('error', e)
        }

        setTimeout(
            function () {
                self.monitorMinedPayments()
            }, 4000
        )
    },
    async requestTransactionReceipt(_txHash) {
        /* Validate transaction hash. */
        if (typeof _txHash === 'undefined' || _txHash === null) {
            console.error('ERROR: requestTransactionReceipt', _txHash)

            return null
        }

        /* Retrieve transaction receipt. */
        const receipt = await this.web3.eth.getTransactionReceipt(_txHash)
            .catch(_error => {
                console.error('ERROR: Could not find receipt',
                    typeof _txHash, _txHash, _error)
            })

        return receipt
    },
    //checks each to see if they have been mined
    async checkMinedSolutions(solution_txes) {
        for (let i in solution_txes) {
            const tx_hash = solution_txes[i]

            /* Validate transaction hash. */
            if (typeof tx_hash === 'undefined' || typeof tx_hash === null) {
                console.log('FOUND INVALID TX HASH', tx_hash)

                /* Delete tx hash from db. */
                await this.redisInterface.deleteHashInRedis(
                    'unconfirmed_submitted_solution_tx', tx_hash)

                /* Continue to next. */
                continue
            }

            /* Validate transaction hash length. */
            if (tx_hash.length !== 64 && tx_hash.length !== 66) {
                console.log(
                    'FOUND INVALID TX HASH LENGTH', tx_hash.length, tx_hash)

                /* Delete tx hash from db. */
                await this.redisInterface.deleteHashInRedis(
                    'unconfirmed_submitted_solution_tx', tx_hash)

                /* Continue to next. */
                continue
            }

            const txDataJSON = await this.redisInterface.findHashInRedis(
                'unconfirmed_submitted_solution_tx', tx_hash)

            const transactionData = JSON.parse(txDataJSON)
            // console.log(transactionData)

            if (transactionData.mined === false) {
                const liveTransactionReceipt =
                    await this.requestTransactionReceipt(tx_hash)

                if (liveTransactionReceipt !== null) {
                    // console.log('got receipt',liveTransactionReceipt )

                    transactionData.mined = true

                    const transaction_succeeded = (liveTransactionReceipt.status === true) ||
                        (web3utils.hexToNumber(liveTransactionReceipt.status) === 1)

                    if (transaction_succeeded) {
                        transactionData.succeeded = true

                        // console.log('transaction was mined and succeeded',tx_hash)
                    } else {
                        // console.log('transaction was mined and failed',tx_hash)
                    }

                    /* Delete tx hash from db. */
                    await this.redisInterface.deleteHashInRedis(
                        'unconfirmed_submitted_solution_tx', tx_hash)

                    // save as confirmed
                    await this.saveSubmittedSolutionTransactionData(
                        tx_hash, transactionData)
                } else {
                    // console.log('got null receipt',tx_hash)
                }
            }

            if (
                transactionData.mined === true &&
                transactionData.succeeded === true &&
                transactionData.rewarded === false
            ) {
                console.log('found unrewarded successful transaction!', tx_hash)

                await this.grantTokenBalanceRewardForTransaction(
                    tx_hash, transactionData)

                transactionData.rewarded = true

                await this.saveSubmittedSolutionTransactionData(
                    tx_hash, transactionData)
            }
        }
    },
    /*
    For every balance payment, make sure there is a good transfer payment
    */
    async checkMinedPayments(balance_xfers) {
        return
        //console.log('check mined payments')

        const currentEthBlock = await this.redisInterface.getEthBlockNumber()

        const REBROADCAST_WAIT_BLOCKS = 500

        for (let i in balance_xfers) {
            var paymentId = balance_xfers[i]

            var paymentDataJSON = await this.redisInterface.findHashInRedis(
                'balance_payment', paymentId)

            var paymentData = JSON.parse(paymentDataJSON)

            // who to pay and how much to pay them
            var tokenAmount = paymentData.previousTokenBalance
            var minerAddress = paymentData.minerAddress

            var txDataJSON = await this.redisInterface.findHashInRedis(
                'payment_tx', paymentId)

            var txData = JSON.parse(txDataJSON)

            var balanceTransferJSON = await this.redisInterface.findHashInRedis(
                'balance_transfer', paymentId)

            var transferData = JSON.parse(balanceTransferJSON)

            // Too confusing !! too many data pieces are being examined

            // if a tx exists and was confirmed, we don't need to touch it
            // is this correct !?
            if (transferData !== null && transferData.confirmed === true) {
                continue
            }

            // if a tx doesn't exist or it does but is unconfirmed and old, we need to pay it
            if (txDataJSON === null || (txData.last_broadcast_block < (currentEthBlock - REBROADCAST_WAIT_BLOCKS)) ) {
                //make a payment_tx and set its block to a current one

                var broadcastedPaymentData = {
                    balancePaymentId     : paymentId,
                    minerAddress         : minerAddress,
                    tokenAmount          : tokenAmount,
                    last_broadcast_block : currentEthBlock
                }

                await this.redisInterface.storeRedisHashData(
                    'payment_tx',
                    paymentId.toString(),
                    JSON.stringify(broadcastedPaymentData)
                )

                if (
                    balanceTransferJSON === null ||
                    transferData.txHash == null ||
                    transferData.confirmed !== true
                ) {
                    const transferData = {
                        addressTo        : minerAddress,
                        balancePaymentId : paymentId,
                        tokenAmount      : tokenAmount,
                        txHash           : null,
                        block            : currentEthBlock,
                        confirmed        : false
                    }

                    // I think this has a null amount

                    //need to rebroadcast for sure
                    await this.queueBalancePayment(transferData)
                }
            }

            //why doesnt this work !?
            if (
                transferData !== null &&
                transferData.txHash !== null &&
                transferData.confirmed !== true
            ) {
                //try to get receipt via txhash
                var txHash = transferData.txHash

                console.log('inspecting unconfirmed balance transfer', txHash)
                if (!txHash) {
                    return
                }

                const liveTransactionReceipt = await this.requestTransactionReceipt(txHash)

                if (liveTransactionReceipt !== null ) {
                    console.log('got receipt', liveTransactionReceipt)

                    transferData.confirmed = true // also called 'mined'

                    var transaction_succeeded = liveTransactionReceipt.status === true || (web3utils.hexToNumber( liveTransactionReceipt.status) == 1 );
                    //var transaction_succeeded =  (web3utils.hexToNumber( liveTransactionReceipt.status) == 1 )

                    if (transaction_succeeded) {
                        transferData.succeeded = true
                        //console.log('transaction was mined and succeeded',txHash)
                    } else {
                        await this.queueBalancePayment(transferData)
                        //console.log('transaction was mined and failed',txHash)
                    }

                    //await this.redisInterface.deleteHashInRedis('unconfirmed_broadcasted_payment',paymentId)

                    //save balance_transfer as confirmed
                    await this.redisInterface.storeRedisHashData(
                        'balance_transfer',
                        paymentId,
                        JSON.stringify(transferData)
                    )
                } else {
                    //console.log('got null balance transfer receipt',txHash)
                }

                //maybe rebroadcast if it failed

                //hdel this record so we dont keep checking it
                //save a new happy confirmed record
            }
        }
    },
    async queueBalancePayment(paymentData) {
        return

        var balancePaymentId = paymentData.balancePaymentId

        // var existingReplacementPayment = await this.redisInterface.findHashInRedis('queued_replacement_payment',balancePaymentId)

        var currentEthBlock = await this.redisInterface.getEthBlockNumber()

        //make sure only one replacement tx is being queued
        //   if( existingReplacementPayment == null   )
        //   {
        //paymentData.last_broadcast_block = currentEthBlock;

        await this.redisInterface.storeRedisHashData(
            'queued_balance_payment',
            balancePaymentId,
            JSON.stringify(paymentData)
        )
        //console.log('queue balance payment');

        await this.tokenInterface.queueTokenTransfer(
            paymentData.addressTo,
            paymentData.tokenAmount,
            paymentData.balancePaymentId
        )
    },
    async saveSubmittedSolutionTransactionData(tx_hash, transactionData) {
        await this.redisInterface.storeRedisHashData(
            'submitted_solution_tx',
            tx_hash,
            JSON.stringify(transactionData)
        )

        await this.redisInterface.pushToRedisList(
            'submitted_solutions_list',
            JSON.stringify(transactionData)
        )
    },
    async loadStoredSubmittedSolutionTransaction(tx_hash) {
        var txDataJSON = await this.redisInterface.findHashInRedis(
            'submitted_solution_tx', tx_hash)

        var txData = JSON.parse(txDataJSON)

        return txData
    },
    async grantTokenBalanceRewardForTransaction(tx_hash, transactionData) {
        console.log('grantTokenBalanceRewardForTransaction', transactionData)

        // var merge_mining_addresses = transactionData['merge_mining_addresses']

        var reward_amount = transactionData.token_quantity_rewarded

        var fee_percent = this.poolConfig.poolTokenFee / 100.0  // 5

        if (fee_percent > 1.0) fee_percent = 1.0
        if (fee_percent < 0) fee_percent = 0.0

        var reward_amount_for_miners = Math.floor(reward_amount - (reward_amount * fee_percent))
        //console.log('granting',reward_amount)

        var minerList =  await this.getMinerList()
        var all_miner_data = {}

        //build data structure
        for (let i in minerList) { // reward each miner
            try {
                var minerAddress = minerList[i]
                var minerData = await this.getMinerData(minerAddress)

                all_miner_data[minerAddress] = minerData
            } catch (e) {
                console.log(e)
            }
        }

        var total_shares = this.getTotalMinerShares(all_miner_data)

        for (let i in minerList) { // reward each miner
            try {
                var minerAddress = minerList[i]

                var minerData = all_miner_data[minerAddress]

                //console.log('minerData',minerData)

                var miner_shares = minerData.shareCredits

                var miner_percent_share = parseFloat(miner_shares) / parseFloat(total_shares)

                if (isNaN(miner_percent_share)) {
                    miner_percent_share = 0
                }

                //console.log('miner_percent_share',miner_percent_share)  //nan

                var tokensOwed = Math.floor(reward_amount_for_miners * miner_percent_share)  //down to 8 decimals

                //console.log('tokensOwed',tokensOwed)

                var  newTokenBalance = parseInt(minerData.tokenBalance)

                if (isNaN(newTokenBalance)) {
                    newTokenBalance = 0
                }

                newTokenBalance += tokensOwed
                var old_balance = minerData.tokenBalance
                minerData.tokenBalance = newTokenBalance
                minerData.shareCredits = 0 //wipe old shares

                //do it in a sort of manual way

                // var SEDO_ADDRESS = '0x0F00f1696218EaeFa2D2330Df3D6D1f94813b38f'
                // var SEDO_REWARD_RATIO = 25/50
                //
                // if (merge_mining_addresses.includes(SEDO_ADDRESS)) {
                //     var sedoTokenBalance = parseInt( minerData.sedoTokenBalance )
                //
                //     if (isNaN(sedoTokenBalance)) {
                //         sedoTokenBalance = 0
                //     }
                //
                //     sedoTokenBalance += tokensOwed * SEDO_REWARD_RATIO
                //     var sedo_old_balance = minerData.sedoTokenBalance
                //     minerData.sedoTokenBalance = sedoTokenBalance
                //     minerData.sedoReward = tokensOwed*SEDO_REWARD_RATIO
                //     minerData.shareCredits = 0 //wipe old shares
                // }

                //console.log('tokenBalance', minerData.tokenBalance)
                const rewardData = {
                    'id'                       : tx_hash,
                    'minerAddress'             : minerAddress,
                    'previousTokenBalance'     : old_balance,
                    'newTokenBalance'          : newTokenBalance,
                    'shares'                   : miner_shares,
                    'totalShares'              : total_shares,
                    'tokensAwarded'            : minerData.tokensAwarded,
                    'reward'                   : tokensOwed,
                    // 'sedoTokenBalance'         : minerData.sedoTokenBalance,
                    // 'sedoReward'               : minerData.sedoReward,
                    // 'previousSedoTokenBalance' : sedo_old_balance,
                    'time'                     : peerUtils.getUnixTimeNow()
                }

                await this.saveMinerDataToRedis(minerAddress, minerData)

                await this.saveMinerRewardToRedis(minerAddress, rewardData)

                //   var minerShares = minerData.
            } catch (e) {
                console.log(e, minerData)
            }
        }

        //console.log('finished granting tokens owed ')
    },
    //need to know when one of our mining solutions SUCCEEDS
    // then we will start a new round and record tokens owed !
    checkTokenBalance() {
        //
    },
    async getShareCreditsFromDifficulty(difficulty, shareIsASolution) {
        var minShareDifficulty = this.getPoolMinimumShareDifficulty()

        var miningDifficulty = parseFloat( await this.tokenInterface.getPoolDifficulty() )

        if (shareIsASolution) { // (difficulty >= miningDifficulty)
            // if submitted a solution
            // return 10000;

            var amount = Math.floor(difficulty)
            //console.log('credit amt ', amount,minShareDifficulty,miningDifficulty )

            amount += SOLUTION_FINDING_BONUS

            return amount
        } else if (difficulty >= minShareDifficulty) {
            var amount = Math.floor(difficulty)
            //console.log('credit amt ', amount,minShareDifficulty,miningDifficulty )

            return amount
        }

        console.log(
            'NO SHARES for this solve!!', difficulty, minShareDifficulty)

        return 0
    },
    async awardShareCredits(minerEthAddress, shareCredits) {
        //console.log('awarding shares : ' + shareCredits )
        var minerData = await this.loadMinerDataFromRedis(minerEthAddress)

        if( minerData.shareCredits == null || isNaN(minerData.shareCredits)) minerData.shareCredits = 0
        if( shareCredits == null || isNaN(shareCredits)) shareCredits = 0

        minerData.shareCredits += parseInt(shareCredits);
        minerData.validSubmittedSolutionsCount += 1;
        minerData.lastSubmittedSolutionTime = peerUtils.getUnixTimeNow();

        //console.log( 'miner data - award shares ', minerEthAddress, JSON.stringify(minerData))

        await this.saveMinerDataToRedis(minerEthAddress,minerData)
    },
    async saveMinerRewardToRedis(minerEthAddress, rewardData) {
        this.redisInterface.pushToRedisList(
            'miner_reward:' + minerEthAddress,
            JSON.stringify(rewardData)
        )
    },
    async saveMinerDataToRedis(minerEthAddress, minerData) {
        await this.redisInterface.storeRedisHashData(
            'miner_data',
            minerEthAddress ,
            JSON.stringify(minerData)
        )
    },
    async loadMinerDataFromRedis(minerEthAddress) {
        /* Initialize existing miner data. */
        let existingMinerData = null

        const existingMinerDataJSON = await this.redisInterface
            .findHashInRedis('miner_data', minerEthAddress)

        if (existingMinerDataJSON === null) {
            existingMinerData = this.getDefaultMinerData()
        } else {
            existingMinerData = JSON.parse(existingMinerDataJSON)
        }

        return existingMinerData
    },
    getDefaultMinerData(){
        return {
            shareCredits  : 0,
            tokenBalance  : 0, // what the pool owes
            tokensAwarded : 0,
            varDiff       : 1, // default
            validSubmittedSolutionsCount : 0
        }
    },
    async getTotalMinerHashrate() {
        const allMinerData = await this.getAllMinerData()

        let hashrateSum = 0

        for (let i in allMinerData) {
            try {
                const data = allMinerData[i].minerData

                // let minerAddress = data.minerAddress
                let minerHashrate = parseInt(data.hashRate)

                if (isNaN(minerHashrate)) {
                    minerHashrate = 0
                }

                hashrateSum += minerHashrate
            } catch (e) {}
        }

        //console.log('got miner total hashRate in KHs', hashrateSum)

        return hashrateSum / 1000
    },
    getTotalMinerShares(allMinerData) {
        let totalShares = 0

        for (let i in allMinerData) {
            try {
                const minerShares = allMinerData[i].shareCredits

                totalShares += minerShares
            } catch (e) {
                console.error(e)
            }
        }

        //console.log('got miner total shares', totalShares)

        return totalShares
    },
    async getAllMinerData() {
        const minerList = await this.getMinerList()

        const results = []

        for (let i in minerList) {
            const minerAddress = minerList[i]
            const minerData = await this.getMinerData(minerAddress)

            results.push({
                minerAddress : minerAddress,
                minerData    : minerData
            })
        }

        return results
    },
    async getMinerData(minerEthAddress) {
        const minerDataJSON = await this.redisInterface
            .findHashInRedis('miner_data', minerEthAddress)

        try {
            return JSON.parse(minerDataJSON)
        } catch (e) {}
    },
    async getMinerList( ) {
        const minerData = await this.redisInterface
            .getResultsOfKeyInRedis('miner_data' )

        return minerData
    },
    async initJSONRPCServer(port) {
        /* Localize this. */
        const self = this

        if (port === 9000) {
            PROCESS_DIFFICULTY = 4 * 1024
        } else if (port === 9001) {
            PROCESS_DIFFICULTY = 6 * 1024
        } else if (port === 9002) {
            PROCESS_DIFFICULTY = 8 * 1024
        } else if (port === 9003) {
            PROCESS_DIFFICULTY = 16 * 1024
        } else if (port === 9004) {
            PROCESS_DIFFICULTY = 2 * 1024
        } else if (port === 9005) {
            PROCESS_DIFFICULTY = 1024
        }

        // PROCESS_DIFFICULTY = 1
        PROCESS_DIFFICULTY = 64
        // PROCESS_DIFFICULTY = 65536

        // console.log('DIFF:', port, PROCESS_DIFFICULTY)

        /* Create a JSONRPC server. */
        const server = jayson.server({
            ping: function(args, callback) {
                callback(null, 'pong')
            },
            getPoolEthAddress: function(args, callback) {
                /* Set pool ETH address. */
                const poolEthAddress =
                    self.getMintingAccount().address.toString()

                callback(null, poolEthAddress)
            },
            getMinimumShareDifficulty: async function(args, callback) {
                /* Set miner ETH address. */
                const minerEthAddress = args[0]

                /* Set variable difficulty. */
                const varDiff = await self.getMinerVarDiff(minerEthAddress)

                callback(null, varDiff)
            },
            getMinimumShareTarget: async function(args, callback) {
                /* Set miner ETH address. */
                const minerEthAddress = args[0]

                /* Set variable difficulty. */
                const varDiff = await self.getMinerVarDiff(minerEthAddress)

                // NOTE: Always described in 'hex' to the cpp miner.
                const minTargetBN = self._getPoolMinimumShareTarget(varDiff)

                //console.log('giving target ', minTargetBN , minTargetBN.toString(16) )
                callback(null, minTargetBN.toString())
            },
            getChallengeNumber: async function(args, callback) {
                let challengeNumber = await self.redisInterface
                    .loadRedisData('challengeNumber')

                if (challengeNumber !== null) {
                    challengeNumber = challengeNumber.toString()
                }

                callback(null, challengeNumber)
            },
            getAllMiningParameters: async function(args, callback) {
                /*
                Any values in the args parameter which have changed pool-side will
                be included in the response object. Values that are the same are
                omitted. If keys are completely omitted from the args object they will
                also be omitted from the response.

                Note: If 'shareTarget' or 'shareDifficulty' keys are requested, the
                `clientEthAddress' key must be included. Otherwise it may be omitted.
                */

                const response = {}

                /* pool eth address */
                if ('poolEthAddress' in args) {
                    let address = self.getMintingAccount().address.toString()

                    if (args.poolEthAddress !== address) {
                        response.poolEthAddress = address
                    }
                }

                /* challenge number */
                if ('challengeNumber' in args) {
                    let challengeNumber = await self.redisInterface
                        .loadRedisData('challengeNumber')

                    /* not 100% sure why this check is here, but it can't hurt to leave it */
                    if (challengeNumber !== null) {
                        challengeNumber = challengeNumber.toString()
                    }

                    if (args.challengeNumber !== challengeNumber) {
                        response.challengeNumber = challengeNumber
                    }
                }

                /* difficulty */
                if ('shareDifficulty' in args) {
                    let varDiff = await self.getMinerVarDiff(args.minerEthAddress)

                    if (args.shareDifficulty !== varDiff) {
                        response.shareDifficulty = varDiff
                    }
                }

                /* share target */
                if ('shareTarget' in args) {
                    let varDiff = await self.getMinerVarDiff(args.minerEthAddress)

                    let share_target =
                        self._getPoolMinimumShareTarget(varDiff).toString()

                    if (args.shareTarget !== share_target) {
                        response.shareTarget = share_target
                    }
                }

                callback(null, response)
            },
            submitShare: async function (args, callback) {
                /* Initialize valid JSON flag. */
                let validJSONSubmit = true

                /* Localize arguments. */
                const nonce           = args[0]
                const minerEthAddress = args[1]
                const digest          = args[2]
                const difficulty      = args[3]
                const challengeNumber = args[4]

                /* Validate arguments. */
                if (
                    difficulty      === null ||
                    nonce           === null ||
                    minerEthAddress === null ||
                    challengeNumber === null ||
                    digest          === null
                ) {
                    validJSONSubmit = false

                    return callback(null, validJSONSubmit)
                }

                /* Set minimum share difficulty. */
                const minShareDifficulty = self.getPoolMinimumShareDifficulty()

                /* Validate minimum share difficulty. */
                if (difficulty < minShareDifficulty) {
                    validJSONSubmit = false

                    return callback(null, validJSONSubmit)
                }

                const poolEthAddress = self.getMintingAccount().address

                const poolChallengeNumber = await self.tokenInterface
                    .getPoolChallengeNumber()

                const computed_digest = web3utils.soliditySha3(
                    poolChallengeNumber, poolEthAddress, nonce)

                const digestBigNumber = web3utils.toBN(digest)
                const claimedTarget = self.getTargetFromDifficulty(difficulty)

                /* Validate claimed target. */
                if (
                    computed_digest !== digest ||
                    digestBigNumber.gt(claimedTarget)
                ) {
                    validJSONSubmit = false

                    return callback(null, validJSONSubmit)
                }

                /* Set ETH block number. */
                const block = await self.redisInterface.getEthBlockNumber()

                const shareData = {
                    block,
                    nonce,
                    minerEthAddress,
                    challengeNumber,
                    digest,
                    difficulty
                }

                const response = await self.redisInterface.pushToRedisList(
                    'queued_shares_list', JSON.stringify(shareData))

                callback(null, validJSONSubmit)
            },
            getMinerData: async function (args, callback) {
                const minerEthAddress = args[0]

                /* Initailize data object. */
                let minerData = null

                if (web3utils.isAddress(minerEthAddress.toString())){
                    minerData = await self.getMinerData(minerEthAddress)
                } else {
                    console.log('getMinerData error: not a valid address')
                }

                // console.log('meep',minerData)
                callback(null, JSON.stringify(minerData))
            },
            getAllMinerData: async function(args, callback) {
                var minerData = await self.getAllMinerData()

                callback(null, JSON.stringify(minerData))
            },
        })

        /* Start JSONRPC (server) listener. */
        server.http().listen(port)

        console.log('Listening on JSONRPC server localhost:', port)
    },
    async getAllTransactionData() {
        const ethereumTransactionHashes = await this.redisInterface
            .getResultsOfKeyInRedis('active_transactions')

        const ethereumTransactions = []

        for (leti in ethereumTransactionHashes) {
            const hash = ethereumTransactionHashes[i]
            // console.log('hash', hash)

            const packetDataJSON = await this.redisInterface
                .findHashInRedis('active_transactions', hash)

            const packetData = JSON.parse(packetDataJSON)

            packetData.txHash = hash

            ethereumTransactions.push(packetData)
        }

        return ethereumTransactions
    },
    async getPoolData() {
        return {
            tokenFee       : this.poolConfig.poolTokenFee,
            mintingAddress : this.accountConfig.minting.address,
            paymentAddress : this.accountConfig.payment.address
        }
    },
    getMintingAccount() {
        return this.accountConfig.minting
    },
    getPaymentAccount() {
        return this.accountConfig.payment
    }
}
