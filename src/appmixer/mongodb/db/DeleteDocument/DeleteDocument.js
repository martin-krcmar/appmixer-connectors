'use strict';
const { getClient, getCollection, closeClient } = require('../../common');
const { ObjectId } = require('mongodb');

module.exports = {

    async start(context) {
        const { componentId, flowId } = context;
        const connectionUri = context.auth.connectionUri;

        const { connectionId } = await getClient(context, flowId, componentId, connectionUri, context.auth);

        context.stateSet('connectionId', connectionId);


    },

    async stop(context) {

        const connectionId = await context.stateGet('connectionId');
        await closeClient(context, connectionId);
        await context.stateUnset('connectionId');
    },

    async receive(context) {
        const { componentId, flowId } = context;
        const connectionUri = context.auth.connectionUri;
        const connectionId = await context.stateGet('connectionId');

        if (!connectionId) {

            await context.log({ step: 'connecting', message: 'Connection to mongo not yet established. Waiting for connectionId.' });
            // It might have happened that the connectionId was not yet stored to the state in the start() method.
            // This can occur if another component sent a message to our SendMessage before our start() method finished.
            // See e.g. the implementation of OnStart (https://github.com/clientIO/appmixer-connectors/blob/dev/src/appmixer/utils/controls/OnStart/OnStart.js).
            const checkStartTime = new Date;
            const maxWaitTime = 10000;  // 10 seconds
            await new Promise((resolve, reject) => {
                const intervalId = setInterval(async () => {
                    connectionId = await context.stateGet('connectionId');
                    if (connectionId) {
                        clearInterval(intervalId);
                        await context.log({ step: 'connected', message: 'Connection to mongo established.' });
                        resolve();
                    } else if (new Date - checkStartTime > maxWaitTime) {
                        clearInterval(intervalId);
                        reject(new Error('Connection not established.'));
                    }
                }, 500);
            });
        }

        const { client } = await getClient(context, flowId, componentId, connectionUri, context.auth, connectionId);
        const { collection: collectionName, id, filter, quantity } = context.messages.in.content;

        const query = id ? { _id: ObjectId.isValid(id) ? new ObjectId(id) : (+id || id) } : JSON.parse(filter || '{}');

        try {
            const collection = getCollection(client, context.auth.database, collectionName);
            const deleteMethod = quantity === 'One' ? 'deleteOne' : 'deleteMany';
            const { deletedCount } = await collection[deleteMethod](query);
            await context.sendJson({ deletedCount }, 'out');
        } catch (error) {
            throw error;
        }
    }
};
