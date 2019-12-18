const program = require('commander');
const path = require('path');
const BuildWatch = require('./BuildWatch.js');

program
.arguments('[inputdir] <entity>')
.action((inputdir, entity) => {
    if(!inputdir)
        inputdir = process.cwd();
    console.log(`${path.join(inputdir, entity + '.json')}`);
});