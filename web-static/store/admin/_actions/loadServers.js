/* Set API endpoint. */
const ENDPOINT = 'https://api.nexa.rocks/v1/admin'

/**
 * Load Servers
 *
 * @param {Object} _constructors
 * @returns
 */
const loadServers = async ({ rootState, commit }) => {
    let content

    /* Request issuer. */
    const didToken = rootState.profile.didToken

    /* Validate issuer. */
    if (didToken) {
        const rawResponse = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                didToken,
                action: 'get_servers'
            })
        })

        content = await rawResponse.json()
        // console.log('CONTENT (get_servers):', content)

        /* Set servers. */
        commit('SET_SERVERS', content)
    }

    return content
}

/* Export module. */
module.exports = loadServers
