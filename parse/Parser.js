/**
* GQLAPP_MODEL_PARSER V0.0.1
* This meta engineering tool helps create models from description files.
*/
const fs = require('fs');
const path = require('path');
const Mongoose = require('mongoose');
const GraphQL = require('graphql');
const { GraphQLDate, GraphQLTime, GraphQLDateTime } = require('graphql-iso-date');
const beautify = require('js-beautify').js;

String.prototype.replaceAll = function(f,r){return this.split(f).join(r);};

class Parser {

    parseAll(modelsDirectory, outputDirectory) {
        var files = fs.readdirSync(modelsDirectory);
        var types = [], queries = {}, mutations = {}, errors = [];
        try {
            files.forEach((file, i) => {
                var fileinfo = path.parse(file);
                if(fileinfo.ext === '.json') {
                    var { mongooseCode, gqlCode, gqlQuery, gqlMutation } = this.parse(path.join(modelsDirectory, file), fileinfo.name);
                    if(!fs.existsSync(path.join(outputDirectory, 'models')))
                        fs.mkdirSync(path.join(outputDirectory, 'models'));
                    if(!fs.existsSync(path.join(outputDirectory, 'schema')))
                        fs.mkdirSync(path.join(outputDirectory, 'schema'));
                    fs.writeFileSync(path.join(outputDirectory, 'models', fileinfo.name + '.js'), mongooseCode);
                    fs.writeFileSync(path.join(outputDirectory, 'schema', fileinfo.name + '.js'), gqlCode);
                    types.push(fileinfo.name);
                    queries[fileinfo.name] = gqlQuery;
                    mutations[fileinfo.name] = gqlMutation;
                }
            });
        } catch (error) {
            errors.push(error);
        }
        fs.writeFileSync(path.join(outputDirectory, 'models', 'index.js'), Parser.GetModelCompiler(types));
        fs.writeFileSync(path.join(outputDirectory, 'schema', 'index.js'), Parser.GetGQLCompiler(types, queries, mutations));
        return errors;
    }
    static GetModelCompiler(types) {
        var text = 'module.exports = {';
        for(var type of types) {
            text += type + ': require("./' + type + '.js"),';
        }
        text += '}';
        return beautify(text);
    }
    static GetGQLCompiler(types, queries, mutations) {
        var text = 'var GraphQL = require("graphql"); var { GraphQLDate, GraphQLTime, GraphQLDateTime } = require("graphql-iso-date"); var Models = require("../models"); ';
        for(var type of types) {
            text += 'const { ' + type + 'Type, ' + type + 'InputType } = require("./' + type + '.js");';
        }
        text += 'const RootQuery = new GraphQL.GraphQLObjectType({ name: "RootQueryType", fields: {';
        for(let [name, query] of Object.entries(queries)) {
            text += name + ':' + query + ',';
        }
        text += '} });';
        text += 'const Mutation = new GraphQL.GraphQLObjectType({ name: "Mutation", fields: {';
        for(let [name, mutation] of Object.entries(mutations)) {
            text += 'add' + name + ':' + mutation.add + ',';
            text += 'update' + name + ':' + mutation.update + ',';
            text += 'remove' + name + ':' + mutation.remove + ',';
        }
        text += '} });';
        text += 'module.exports = new GraphQL.GraphQLSchema({ query: RootQuery, mutation: Mutation });';
        return beautify(text);
    }
    parse(filepath, modelName) {
        var description = fs.readFileSync(filepath, { encoding: 'utf-8' });
        var ast = JSON.parse(description);
        var mongooseModel = this._buildModel(modelName, ast);
        var mongooseCode = this._bakeMongooseModelCode(modelName, mongooseModel);
        var gqlModel = this._buildGQModel(modelName, ast);
        var gqlCode = this._bakeGQLModelCode(modelName, gqlModel);
        return {mongooseCode, gqlCode, gqlQuery: gqlModel.query, gqlMutation: gqlModel.mutation};
    }

    _bakeMongooseModelCode(modelName, model) {
        var text = model.require.join(";") + "; const " + modelName + "Schema = new Mongoose.Schema(" + model.definition + ");";
        for(var [name, method] of Object.entries(model.methods)) {
            text += modelName + 'Schema.methods.' + name + ' = ' + method + ';';
        }
        text += 'module.exports = Mongoose.model("' + modelName +'", ' + modelName + 'Schema);';
        return beautify(text, { indent_size: 2, space_in_empty_paren: true });
    }
    
    _bakeGQLModelCode(modelName, model) {
        var text = "var GraphQL = require('graphql'); var { GraphQLDate, GraphQLTime, GraphQLDateTime } = require('graphql-iso-date'); var Models = require('../models'); const " + modelName + "Type = new GraphQL.GraphQLObjectType({ name: '" + modelName + "', fields: () => (" + model.definition + ") });\
        const " + modelName + "InputType = new GraphQL.GraphQLInputObjectType({ name: '" + modelName + "Input', fields: () => (" + model.inputDefinition + ") });";
        text += 'module.exports = { '+ modelName + 'Type, '+ modelName + 'InputType };' + model.require.join(";") + ";";
        return beautify(text, { indent_size: 2, space_in_empty_paren: true });
    }

    _buildModel(modelName, ast) {
        var model = { require: ['const Mongoose = require("mongoose")'], definition: "", methods: {} };
        model.definition = '{';
        for(var key in ast) {
            if(Array.isArray(ast[key])) {
                var bindings = Parser.GetMongooseBindings(key, ast[key][0], modelName, true);
                bindings.type = `[${bindings.type}]`;
            }
            else if(typeof ast[key] === 'object' && ast[key] !== null) {
                var submodel = this._buildModel(modelName, ast[key]);
                var bindings = {
                    require: submodel.require.filter((v) => !model.require.includes(v)),
                    type: submodel.definition,
                    methods: {},
                    nullable: true
                };
                if(submodel.methods) {
                    for(var [name, method] of Object.entries(submodel.methods)) {
                        bindings.methods[key + "_" + name] = method;
                    }
                }
            }
            else {
                var bindings = Parser.GetMongooseBindings(key, ast[key], modelName);
            }

            if(bindings.require)
                model.require.push(...bindings.require.filter((v) => !model.require.includes(v)));
            if(bindings.methods) {
                for(var [name, method] of Object.entries(bindings.methods))
                    model.methods[name] = method;
            }
            model.definition += 
            `${key}: {
                type: ${bindings.type}${bindings.nullable?'':',required: true'}${bindings.unique?',index: true, unique: true':''}
            },
            `;
        }
        model.definition += '}';
        console.log(model.definition);
        return model;
    }

    _buildGQModel(modelName, ast) {
        var model = { require: [], definition: "", inputDefinition: "", query: "", mutation: { add: "", update: "", remove: "" } };
        model.definition = '{ _id: { type: GraphQL.GraphQLID },';
        model.inputDefinition = '{';
        var passwordFields = { singulars: [], arrays: [] };
        var uniqueFields = [];
        for(var key in ast) {
            if(Array.isArray(ast[key])) {
                if(ast[key][0] === 'PasswordHash') {
                    model.inputDefinition += key + ':{ type: GraphQL.GraphQLList(GraphQL.GraphQLString) },';
                    passwordFields.arrays.push(key);
                    continue;
                }
                var bindings = Parser.GetGQLBindings(key, ast[key][0], modelName);
                bindings.inputType = `type: ${bindings.nullable?`GraphQL.GraphQLList(${bindings.inputType})`:`GraphQL.GraphQLNonNull(GraphQL.GraphQLList(${bindings.inputType}))`}`;
                bindings.type = `type: ${bindings.nullable?`GraphQL.GraphQLList(${bindings.type})`:`GraphQL.GraphQLNonNull(GraphQL.GraphQLList(${bindings.type}))`}`;
                if(bindings.unique)
                    uniqueFields.push({ name: key, typedef: bindings.type });
                if(bindings.requiresResolve) {
                    bindings.type += `,
                    resolve(parent, args) {
                        var list = [];
                        parent.` + key + `.forEach((v,i) => {
                            list.push(Models.` + ast[key][0] + `.findOne({ _id: v._id }));
                        });
                        return list;
                    }`;
                }
            }
            else if(typeof ast[key] === 'object' && ast[key] !== null) {
                var submodel = this._buildGQModel(modelName+key, ast[key]);
                var bindings = {
                    require: submodel.require.filter((v) => !model.require.includes(v)),
                    inputType: "type: new GraphQL.GraphQLInputObjectType({name:'" + modelName + key + "Input', fields: " + submodel.inputDefinition + "})",
                    type: "type: new GraphQL.GraphQLObjectType({name:'" + modelName + key + "', fields: " + submodel.definition + "})"
                };
            }
            else {
                if(ast[key] === 'PasswordHash') {
                    model.inputDefinition += key + ':{ type: GraphQL.GraphQLString },';
                    passwordFields.singulars.push(key);
                    continue;
                }
                var bindings = Parser.GetGQLBindings(key, ast[key], modelName);
                bindings.inputType = `type: ${bindings.nullable?`${bindings.inputType}`:`GraphQL.GraphQLNonNull(${bindings.inputType})`}`;
                bindings.type = `type: ${bindings.nullable?`${bindings.type}`:`GraphQL.GraphQLNonNull(${bindings.type})`}`;
                if(bindings.unique)
                    uniqueFields.push({ name: key, typedef: bindings.type });
                if(bindings.requiresResolve) {
                    bindings.type += `,
                    resolve(parent, args) {
                        return Models.` + ast[key] + `.findOne({ _id: parent.` + key + `._id });
                    },
                    `;
                }
            }

            if(bindings.require)
                model.require.push(...bindings.require.filter((v) => !model.require.includes(v)));
            model.definition += key + ':{' + bindings.type + '},';
            model.inputDefinition += key + ':{' + bindings.inputType + '},';
        }
        model.definition += '}';
        model.inputDefinition += '}';
        model.query = `{
            type: ${modelName}Type,
            args: {
                _id: { type: GraphQL.GraphQLID },
                ${ uniqueFields.map((f) => `${f.name}: { ${f.typedef} }`).join(",") }
            },
            resolve(parent, args) {
                if(args._id)
                    return Models.${modelName}.findOne({ _id: args._id });
                ${
                    uniqueFields.map((f) =>
                    `else if(args.${f.name})
                        return Models.${modelName}.findOne({ ${f.name}: args.${f.name} });
                    `
                    ).join("")
                }
            }
        }`;

        // Replacement policy needs perfecting
        model.mutation.add = `{
            type: ` + modelName + `Type,
            args: ` + model.inputDefinition.replaceAll("'" + modelName, "'" + 'Add' + modelName) + `,
            resolve(parent, args) {
                /* TODO: Make appropriate changes */

               ${
                   passwordFields.singulars.map((field) => `var ${field} = args.${field}; delete args.${field};`).join("")
               }

               ${
                   passwordFields.arrays.map((fieldArray) => `
                   var ${fieldArray} = [];
                   for(var i=0; i < args.${fieldArray}.length; i++) {
                       ${fieldArray}.push(args.${fieldArray}[i]);
                   }
                   `).join("")
               }

                let doc = Models.` + modelName +  `(args);

                ${
                    passwordFields.singulars.map((field) => `doc.set${field}(${field});`)
                }

                ${
                    passwordFields.arrays.map((fieldArray) => `
                    doc.set${field}(args.${field});
                    `).join("")
                }

                return doc.save();
            }
        }`;
        model.mutation.update = `{
            type: ` + modelName + `Type,
            args: {
                _id: { type: GraphQL.GraphQLID },
                changes: {
                    type: new GraphQL.GraphQLInputObjectType({
                        name: "Update` + modelName + `ChangesInput",
                        fields: ` + model.inputDefinition.replaceAll("'" + modelName, "'" + 'Update' + modelName + 'Changes')  + `
                    })
                }
            },
            async resolve(parent, args) {
                /* TODO: Make appropriate changes */
                await Models.` + modelName + `.updateOne({ _id: args._id }, { $set: args.changes });
                return Models.` + modelName + `.findOne({ _id: args._id });
            }
        }`;
        model.mutation.remove = `{
            type: ` + modelName + `Type,
            args: { _id: { type: GraphQL.GraphQLID } },
            resolve(parent, args) {
                var doc = Models.` + modelName + `.findOne({ _id: args._id });
                Models.` + modelName + `.deleteOne({ _id: args._id });
                return doc;
            }
        }`;
        return model;
    }

    static GetGQLBindings(field, type, modelName) {
        var nullable = !type.endsWith("!");
        var unique = type.startsWith("@");
        type = type.replace(/[@!]/g, '');
        if(GraphQL.hasOwnProperty("GraphQL" + type))
            return {
                type: `GraphQL.GraphQL${type}`,
                inputType: `GraphQL.GraphQL${type}`,
                nullable: nullable,
                unique: unique
            };
        if(type === modelName)
            return {
                type: `${type}Type`,
                inputType: `${type}InputType`,
                requiresResolve: true,
                nullable: nullable,
                unique: unique
            };
        if(['Date','Time','DateTime'].includes(type))
            return {
                type: `GraphQL${type}`,
                inputType: `GraphQL${type}`,
                nullable: nullable,
                unique: unique
            };
        return {
            type: `${type}Type`,
            inputType: `${type}InputType`,
            require: [`const {${type}Type, ${type}InputType} = require("./${type}.js")`],
            requiresResolve: true,
            nullable: nullable,
            unique: unique
        };
    }

    static GetMongooseBindings( field, type, modelName, isArray = false ) {
        var nullable = !type.endsWith("!");
        var unique = type.startsWith("@");
        type = type.replace(/[@!]/g, '');
        if(["Int","Float"].includes(type))
            return { type: "Number", unique: unique, nullable: nullable };
        if(type === 'PasswordHash') {
            var methods = {};
            if(isArray) {
                methods[`set${field}`] = `function(passwords) {
                    for(var i=0; i < passwords.length; i++) {
                        this.${field}[i].salt = crypto.randomBytes(16).toString('hex');
                        this.${field}[i].hash = crypto.pbkdf2Sync(password, this.${field}[i].salt, 10000, 512, 'sha512').toString('hex');
                    }
                }`;
                methods[`validate${field}`] = `function(password, i) {
                    const hash = crypto.pbkdf2Sync(password, this.${field}[i].salt, 10000, 512, 'sha512').toString('hex');
                    return this.${field}[i].hash === hash;
                }`;
            }
            else {
                methods[`set${field}`] = `function(password) {
                    this.${field}.salt = crypto.randomBytes(16).toString('hex');
                    this.${field}.hash = crypto.pbkdf2Sync(password, this.${field}.salt, 10000, 512, 'sha512').toString('hex');
                }`;
                methods[`validate${field}`] = `function(password) {
                    const hash = crypto.pbkdf2Sync(password, this.${field}.salt, 10000, 512, 'sha512').toString('hex');
                    return this.${field}.hash === hash;
                }`;
            }
            return {
                type: 'Map',
                methods: methods,
                require: ['const crypto = require("crypto")'],
                unique: unique,
                nullable: nullable
            };
        }
        if(Mongoose.Schema.Types.hasOwnProperty(type))
            return { type: type };
        if(['Date','Time','DateTime'].includes(type))
            return { type: 'Mongoose.Schema.Types.Date' };
        var returnType = '{ _id: Mongoose.Schema.Types.ObjectId }';
        var methods = {};
        methods["get" + field] = `function(_id) {
            return ` + field +`.findOne({ _id });
        }`;
        var require = (type === modelName) ? [] : ['const ' + field + ' = require("./' + type + '.js")'];
        return {
            type: returnType,
            methods: methods,
            require: require,
            unique: unique,
            nullable: nullable
        };
    }
}

module.exports = Parser;