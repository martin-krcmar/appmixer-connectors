/* eslint-disable camelcase */
'use strict';

const lib = require('../../lib');

module.exports = {

    async receive(context) {

        const {
            record_sys_id,
            sysparm_fields
        } = context.messages.in.content;

        const { tableName, generateInspector, generateOutputPortOptions } = context.properties;

        if (generateOutputPortOptions) {
            return lib.toOutputScheme(context, await lib.getColumns(context, { tableName }), sysparm_fields);
        }

        if (generateInspector) {
            return lib.toInspector(context, await lib.getColumns(context, { tableName }), sysparm_fields);
        }

        const inputs = context.messages.in.content;

        const { data } = await lib.callEndpoint(context, {
            method: 'PATCH',
            action: `table/${tableName}/${record_sys_id}`,
            data: inputs,
            params: {
                sysparm_fields
            }
        });

        return context.sendJson(data?.result, 'out');
    }
};
