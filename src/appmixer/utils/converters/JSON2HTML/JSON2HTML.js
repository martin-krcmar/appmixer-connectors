'use strict';
const xlsxHelpers = require('../xlsx-helpers');

module.exports = {

    async receive(context) {

        const { fileId } = context.messages.in.content;
        const savedFile = await xlsxHelpers.convertFile(
            context,
            fileId,
            xlsxHelpers.JSON2Workbook,
            'html',
            'text/html'
        );
        return context.sendJson(savedFile, 'out');
    }
};
