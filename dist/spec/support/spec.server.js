"use strict";
const express = require("express");
const OracleBot = require("../main");
const CONF = require("./spec.config");
const app = express();
// add prefixed /component middleware
app.use(CONF.componentPrefix, OracleBot.Middleware.init({
    parser: CONF.parser,
    component: {
        cwd: __dirname,
        autocollect: 'example/components',
        register: [
            './example/more.components/a.component'
        ]
    }
}));
// apply parser at the top level too.
app.use(OracleBot.Middleware.init({
    parser: CONF.parser
}));
// some things behind the bot MW
app.get('/', (req, res) => {
    res.send(CONF.messages.OK);
});
// to test parser
app.post('/echo', (req, res) => {
    res.json(req.body);
});
// export the http.Server for supertest
const server = app.listen(CONF.port, () => {
    // console.log(`spec server listening on :${CONF.port}`);
});
module.exports = server;
//# sourceMappingURL=spec.server.js.map