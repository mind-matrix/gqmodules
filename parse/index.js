#! /usr/bin/env node
const program = require('commander');
const Parser = require('./Parser');

const parser = new Parser();

program
.arguments('[inputdir] [outputdir]')
.action((inputdir, outputdir) => {
    if(!inputdir)
        inputdir = process.cwd();
    if(!outputdir)
        outputdir = inputdir;
    var errors = parser.parseAll(inputdir, outputdir);
    console.log(`Parsing Complete!
    ${errors.length?`Errors:${errors.join("\n")}`:'No Errors'}`);
})
.parse(process.argv);