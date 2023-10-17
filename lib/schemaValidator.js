/* eslint-disable max-len */
'use strict';

const path = require('path');
const fs = require('fs');
const Ajv = require('ajv/dist/2019');
const jp = require('jsonpath');

/**
 * EpiHiper Validator Class
 */
class SchemaValidator {
  /**
   * Creates an SchemaValidator instance.
   * Usage: `SchemaValidator(schemaDir)`
   * @param {string} schemaDir optional schemaDir
   * @return {Object} SchemaValidator instance
   */
  constructor(schemaDir) {
    if (!(this instanceof SchemaValidator)) {
      return new SchemaValidator(schemaDir);
    }

    this.cwd = path.resolve(process.cwd());

    if (!schemaDir) {
      schemaDir = path.join(__dirname, '..', 'schema');
    }

    this.schemaDir = schemaDir;

    this.pkg = require('../package.json');
    this.cfg = require('../config.json');

    this.ajv = new Ajv({ allowUnionTypes: true });

    const jsonPathFormat = {
      async: false,
      type: 'string',
      validate: function(data) {
        let success = true;
        try {
          const path = jp.parse(data)
        } catch (err) {
          console.log(err);
          success = false;
        }
        return success;
      }
    };

    this.ajv.addFormat('json_path', jsonPathFormat);

    this.cfg.schema.forEach(function(s) {
      const sInstance = require(path.join(schemaDir, s));
      this.ajv.addSchema(sInstance);
    }.bind(this));
  }

  /**
   * Retrieve the first line of a file asynchronously
   * @param {string} file
   * @return {string} firstLine
   */
  async firstLine(file) {
    const {once} = require('events');
    const {createInterface} = require('readline');

    let line = '';

    try {
      const rl = createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
      });

      line = await once(rl, 'line');

      rl.close();
    } catch (err) {
      console.error(err);
    }

    return line;
  }

  /**
   * Load a json file
   * @param {string} file
   * @param {string} relativeTo optional
   * @return {Object} instance;
   */
  async load(file, relativeTo) {
    try {
      file = this.resolvePath(file, relativeTo);
    } catch (err) {
      console.error(err);
    }

    if (!fs.existsSync(file)) {
      console.error('File: ' + file + ' not found');
      return {};
    }

    let RawData = '';
    let Instance = {};

    try {
      RawData = await this.firstLine(file);
      Instance = JSON.parse(RawData);
    } catch (err) {
      try {
        RawData = fs.readFileSync(file);
        Instance = JSON.parse(RawData);
      } catch (err) {
        console.error('File: ' + file + ' does not contain valid JSON.');
        return {};
      }
    }

    Instance.__path = file;
    return Instance;
  }


  /**
   * Process a single file
   * @param {function} validate(instance)
   * @param {string} file
   * @param {string} relativeTo
   * @return {boolean} success
   */
  async processFile(validate, file, relativeTo) {
    const Instance = await this.load(file, relativeTo);
    const success = await validate(Instance);

    if (!success) {
      console.error('Validation failed for \'' + file + '\'');
    }

    return success;
  }

  /**
   * Process a list of files
   * @param {function} validate(instance)
   * @param {Array} files
   * @param {string} relativeTo
   * @return {boolean} success
   */
  async processFiles(validate, files, relativeTo) {
    const Promises = [];

    files.forEach(async function(file) {
      Promises.push(this.processFile(validate, file, relativeTo));
    }.bind(this));

    let success = true;
    const Results = await Promise.all(Promises);

    Results.forEach(function(result) {
      success &= result;
    });

    return success;
  }

  /**
   * Validate whether the provided instace matches the schema
   * @param {Object} instance
   * @return {boolean} success
   */
  async validateSchema(instance) {
    if ((Object.keys(instance).length === 0 && instance.constructor === Object)) return false;

    let success = true;
    const Schema = this.getSchemaURI(instance);

    // Check whether we have the schema already loaded
    const validate = this.ajv.getSchema(Schema);

    if (typeof validate === 'undefined') {
      console.log('Schema: ' + this.getSchemaURI(instance) + ' not found.');
      return success;
    }

    if (success) {
      const valid = validate(instance);

      if (!valid) {
        console.error('File: ' + instance.__path + ' invalid');
        console.error(validate.errors);
        success = false;
      } else {
        console.log('File: ' + instance.__path + ' valid');

        if (Schema == 'runParametersSchema.json' ||
            Schema == 'modelScenarioSchema.json') {
          success &= await this.validateReferencedFiles(instance, this.validateSchema.bind(this));
        }
      }
    }

    return success;
  }

  /**
   * Resolve the pathspec
   * @param {string} pathSpec
   * @param {string} relativeTo
   * @return {string} absolutePath
   */
  resolvePath(pathSpec, relativeTo) {
    const absolute = new RegExp('/^([a-zA-Z]:)?/([^/]+/)*[^/]+$');

    if (absolute.test(pathSpec)) {
      return pathSpec;
    }

    const selfRelative = new RegExp('^self://(([^/]+/)*[^/]+$)');
    const match = selfRelative.exec(pathSpec);

    if (match) {
      return path.resolve(relativeTo, match[1]);
    }

    return path.resolve(this.cwd, pathSpec);
  }

  /**
   * Determine the URI of the schema of the instance
   * @param {object} instance
   * @return {string} schema
   */
  getSchemaURI(instance) {
    let Schema = '';

    if (instance['$schema']) Schema = instance['$schema'];
    if (instance.epiHiperSchema) Schema = instance.epiHiperSchema;

    return Schema;
  }

  /**
   * Determine the name of the schema of the instance
   * @param {object} instance
   * @return {string} schema
   */
  getSchemaName(instance) {
    return path.basename(this.getSchemaURI(instance));
  }
}

module.exports = SchemaValidator;
