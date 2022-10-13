/* Import modules. */
const moment = require('moment')
const PouchDB = require('pouchdb')
const superagent = require('superagent')
const util = require('util')
const { v4: uuidv4 } = require('uuid')

const { Magic } = require('@magic-sdk/admin')

const magicAdmin = new Magic(process.env.MAGIC_LINK_KEY)

/* Initialize databases. */
const logsDb = new PouchDB(`http://${process.env.COUCHDB_AUTH}@localhost:5984/logs`)
const minersDb = new PouchDB(`http://${process.env.COUCHDB_AUTH}@localhost:5984/miners`)
const profilesDb = new PouchDB(`http://${process.env.COUCHDB_AUTH}@localhost:5984/profiles`)
// const sessionsDb = new PouchDB(`http://${process.env.COUCHDB_AUTH}@localhost:5984/sessions`)

/**
 * Administration Module
 */
const admin = async function (req, res) {
    let account
    let action
    let body
    let createdAt
    let data
    let didToken
    let email
    let id
    let issuer
    let metadata
    let pkg
    let profileid
    let results
    let updatedAt

    try {
        body = req.body
        console.log('BODY', body)
    
        /* Validate body. */
        if (body) {
            id = uuidv4()
            createdAt = moment().unix()
    
            pkg = {
                _id: id,
                src: 'magic',
                ...body,
                createdAt,
            }
    
            results = await logsDb
                .put(pkg)
                .catch(err => console.error('LOGS ERROR:', err))
        }
    
        /* Set DID token. */
        didToken = body.didToken
        // console.log('DID Token', didToken)
    
        if (!didToken) {
            /* Set status. */
            res.status(400)
    
            /* Return error. */
            return res.json({
                error: 'Missing DID token.'
            })
        }
    
        /* Set issuer. */
        issuer = magicAdmin.token.getIssuer(didToken)
        // console.log('ISSUER', issuer)
    
        /* Set (public) account/address. */
        account = magicAdmin.token.getPublicAddress(didToken)
        // console.log('ACCOUNT', account)
    
        if (!account) {
            /* Set status. */
            res.status(400)
    
            /* Return error. */
            return res.json({
                error: 'Missing user (account) address.'
            })
        }
    
        /* Set issuer metadata. */
        metadata = await magicAdmin.users.getMetadataByIssuer(issuer)
        // console.log('MAGIC LOGIN (data):', JSON.stringify(metadata, null, 4))
    
        /* Set email address. */
        email = metadata.email
    
        if (!email) {
            /* Set status. */
            res.status(400)
    
            /* Return error. */
            return res.json({
                error: 'Missing user email.'
            })
        }
    
        /* Validate (authorized) administrator. */
        if (email !== 'info@modenero.com' && email !== 's.prince@modenero.com') {
            /* Set status. */
            res.status(401)
    
            /* Return error. */
            return res.json({
                error: 'You are NOT authorized to be here!'
            })
        }
    
        /* Set action. */
        action = body.action
    
        /* Validate action. */
        if (!action) {
            /* Set status. */
            res.status(400)
    
            /* Return error. */
            return res.json({
                error: 'Missing an action.'
            })
        }
    
        if (action === 'get_miners') {
            /* Set profile id. */
            profileid = body.profileid
    
            /* Request existing user. */
            results = await minersDb
                .query('api/byProfile', {
                    key: profileid,
                    include_docs: true,
                })
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('PROFILES RESULT (byProfile)', util.inspect(results, false, null, true))
    
            /* Validate data. */
            if (results && results.rows.length !== 0) {
                /* Map data (doc) results. */
                data = results.rows.map(_miner => {
                    return _miner.doc
                })
            }
    
        }
    
        if (action === 'get_profiles') {
            /* Request existing user. */
            results = await profilesDb
                .query('api/byNickname', {
                    include_docs: true,
                })
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('PROFILES RESULT (byNickname)', util.inspect(results, false, null, true))
    
            /* Validate data. */
            if (results && results.rows.length !== 0) {
                /* Map data (doc) results. */
                data = results.rows.map(_profile => {
                    return _profile.doc
                })
            }
    
        }
    
        if (action === 'add_profile') {
            createdAt = moment().unix()
    
            // TODO: Validate `body.email`.
    
            pkg = {
                _id: uuidv4(),
                nickname: 'anon',
                createdAt,
            }
    
            /* Add new profile. */
            results = await profilesDb
                .put(pkg)
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('PROFILES RESULT (add_profile)', util.inspect(results, false, null, true))
        }
    
        if (action === 'add_miner') {
            createdAt = moment().unix()
    
            pkg = {
                _id: uuidv4(),
                profileid: body.profileid,
                hostname: body.hostname,
                location: body.location,
                auth: body.auth,
                pid: body.pid,
                count: body.count,
                createdAt,
            }
    
            /* Add new profile. */
            results = await minersDb
                .put(pkg)
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('PROFILES RESULT (add_miner)', util.inspect(results, false, null, true))
        }
    
        if (action === 'update_profile') {
            updatedAt = moment().unix()
    
            pkg = {
                ...body.profile,
                updatedAt,
            }
            console.log('UPDATE PROFILE (pkg):', pkg);
            /* Update existing profile. */
            results = await profilesDb
                .put(pkg)
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('PROFILES RESULT (byId)', util.inspect(results, false, null, true))
        }
    
        if (action === 'update_miner') {
            updatedAt = moment().unix()
    
            pkg = {
                ...body.miner,
                updatedAt,
            }
            console.log('UPDATE MINER (pkg):', pkg);
            /* Update existing miner. */
            results = await minersDb
                .put(pkg)
                .catch(err => {
                    console.error('DATA ERROR:', err)
                })
            console.log('MINERS RESULT (byId)', util.inspect(results, false, null, true))
        }
    
        /* Build (result) package. */
        pkg = {
            data,
            error: null,
            success: true,
            metadata,
        }
    
        /* Return params. */
        res.json(pkg)
    } catch (err) {
        console.error('ADMIN ERROR', err)

        return res.json(err)
    }
}

/* Export module. */
module.exports = admin
