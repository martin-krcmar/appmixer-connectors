'use strict';
const Blackboard = require('../../sdk');

module.exports = {

    async receive(context) {

        const { courseId } = context.messages.in.content;

        const client = new Blackboard(
            context.auth.clientId,
            context.auth.clientSecret,
            context.config.serverUrl,
            context.auth.redirectUrl,
            context.httpRequest
        );

        client.setAccessToken(context.auth.accessToken)
        const data = await client.callApi('get', `/v1/courses/${courseId}/gradebook/schemas`);
        return context.sendJson({ schemas: data.results }, 'out');
    },

    toSelectArray({ schemas }) {

        return schemas.map(schema => ({ label: schema.title, value: schema.id }));
    }
}
