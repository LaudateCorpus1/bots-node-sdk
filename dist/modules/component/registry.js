"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const log4js = require("log4js");
const constants_1 = require("../../common/constants");
const definitions_1 = require("../../common/definitions");
class ComponentRegistry {
    /**
     * ComponentRegistry constructor.
     * @param _parent - parent registry for child collection.
     */
    constructor(_parent) {
        this._parent = _parent;
        this._collections = new Map();
        this._components = new Map();
        // setup additional iVars.
        this._logger = log4js.getLogger(this.constructor.name);
    }
    /**
     * Create a registry from a list of component references. The resulting registry
     * is flat and does NOT group components into collections.
     * @param components - array of components, which can be paths, objects, or classes.
     * @param cwd - working directory
     */
    static create(components, cwd = process.cwd()) {
        return new this(null)
            .__buildFromItems(components, cwd);
    }
    /**
     * Assemble a component registry from the filesystem.
     * Directories within the main component directory will be consumed as independent
     * child component collections.
     * @param parent - parent registry for nested "collections"
     * @param componentDir - relative path to component directory
     * @param cwd - working directory
     */
    static assemble(parent, componentDir = this.COMPONENT_DIR, cwd = process.cwd()) {
        // verify absolute component dir
        componentDir = fullPath(cwd, componentDir);
        // instantiate and scan the fs
        return new this(parent)
            .__buildFromFs(componentDir, !parent);
    }
    /**
     * Build a registry with high degree of flexibility in list items.
     * @param list - Array of component references; can be paths, objects, or classes.
     * @param baseDir - Base path reference for resolving string component paths.
     */
    __buildFromItems(list, baseDir) {
        const results = list.map(item => {
            if (isComponent(item)) {
                return [this.__componentFactory(item)];
            }
            else if (typeof item === 'object') {
                // resolve from object containing {[key: string]: component}
                return Object.values(item)
                    .filter(isComponent)
                    .map(ref => this.__componentFactory(ref));
            }
            else if (typeof item === 'string') {
                // resolve from path, considering each path may contain >=1 components
                return this.__digestPath(fullPath(baseDir, item), false);
            }
        }).filter(item => item && item.length); // filter empties
        // flatten and register
        [].concat(...results)
            .forEach(component => this.__register(component));
        return this;
    }
    /**
     * Scan directory for valid components
     * @param baseDir - Top level directory for this registry
     * @param withCollections - group subdirectories as collections
     * @return void
     */
    __buildFromFs(baseDir, withCollections) {
        const dir = path.resolve(baseDir);
        if (fs.existsSync(dir)) {
            this.__scanDir(dir, withCollections)
                .forEach(component => this.__register(component));
        }
        else {
            this._logger.error(`Invalid component directory ${baseDir}`);
        }
        return this;
    }
    /**
     * scan a directory for valid component implementations
     * @param dir - directory to scan for components
     * @param withCollections - group subdirectories as collections
     */
    __scanDir(dir, withCollections) {
        const results = fs.readdirSync(dir) // scan directory for components
            .filter(name => ~['', '.js'].indexOf(path.extname(name))) // js and folders
            .map(name => path.join(dir, name)) // absolute path
            .sort((a, b) => {
            return fs.statSync(a).isDirectory() ? 1 : 0;
        })
            .map(file => this.__digestPath(file, withCollections));
        // because __digest returns an array, we need to flatten the final result.
        return [].concat(...results);
    }
    /**
     * resolve (file|dir)path into component instantiations.
     * @param filePath - absolute path to a component resource or directory
     * @param withCollections - consider directories as separate registry collections.
     */
    __digestPath(filePath, withCollections) {
        // consider case where manual registry is used and contain files references without extensions
        filePath = fs.existsSync(filePath) ? filePath : `${filePath}.js`;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory() && withCollections) {
            // create new registry from the child directory
            this._addCollection(filePath);
        }
        else if (stat.isDirectory()) {
            // scan the directory and flatten
            return this.__scanDir(filePath, false);
        }
        else if (stat.isFile()) {
            // resolve as classes from the files
            return this.__resolveComponents(filePath)
                .map(c => this.__componentFactory(c));
        }
        return [];
    }
    /**
     * create a child collection of components from a subdirectory
     * @param subdir - component subdirectory absolute path
     */
    _addCollection(subdir) {
        this._collections.set(path.basename(subdir), ComponentRegistry.assemble(this, subdir));
    }
    /**
     * resolve Component classes from
     * @param filePath - source file absolute path
     */
    __resolveComponents(filePath) {
        try {
            const mod = require(filePath);
            if (isComponent(mod)) {
                // handle direct export case `export = SomeComponentClass`
                return [mod];
            }
            else {
                // handle case where a single file exports object(s) as keys.
                return Object.values(mod).filter(isComponent);
            }
        }
        catch (e) {
            this._logger.error(e);
            return [];
        }
    }
    /**
     * component instantiation factory.
     * @param mod - component reference (class|object)
     */
    __componentFactory(mod) {
        const ctor = makeCtor(mod);
        return new ctor();
    }
    /**
     * register an instantiated component in
     * @param component - instantiated bot component class
     */
    __register(component) {
        const meta = component.metadata();
        if (this.isComponent(meta.name)) {
            return this._logger.warn(`Duplicate component found: ${meta.name} while attempting to register ${component['constructor'].name}`);
        }
        else {
            this._components.set(meta.name, component);
        }
    }
    /**
     * merge components from another registry
     * @param registry - Source registry for merge operation.
     * @param recursive - Recursively merge into child collections.
     */
    merge(registry, recursive) {
        registry.getComponents().forEach(component => {
            this.__register(component);
            if (recursive) {
                this._collections.forEach(collection => collection.__register(component));
            }
        });
        return this;
    }
    /**
     * Legacy conversation shell compatability "components" property accessor
     * @desc allows components to be resolved by `registry.components`
     */
    get components() {
        const c = {};
        this.getComponents().forEach((component, name) => {
            c[name] = component;
        });
        return c;
    }
    /**
     * test if registry is valid.
     * @return boolean.
     */
    isValid() {
        return (this._components.size || this._collections.size) > 0;
    }
    /**
     * list collections in this registry
     */
    getCollectionNames() {
        let keys = [];
        this._collections.forEach((coll, name) => {
            keys.push(name);
        });
        return keys;
    }
    /**
     * get a registry for a specific collection of components.
     * @param collection - (optional) the name of the collection;
     * @return child registry | this.
     */
    getRegistry(collection) {
        return collection ? this._collections.get(collection) : this;
    }
    /**
     * get component map for this registry
     */
    getComponents() {
        return this._components;
    }
    /**
     * get component from map by name
     * @param name - component name
     */
    getComponent(name) {
        return this._components.get(name);
    }
    /**
     * test existence of collection
     * @param name - collection name
     */
    isCollection(name) {
        return this._collections.has(name);
    }
    /**
     * test existence of component
     * @param name - component name
     */
    isComponent(name) {
        return this._components.has(name);
    }
    /**
     * return component metadata as json array
     * @param collection - the collection name, defaults to the parent collection (optional)
     * @return - array of component metadata
     */
    getMetadata(collection) {
        const registry = this.getRegistry(collection);
        let meta = [];
        if (!!registry) {
            registry.getComponents().forEach((component, name) => {
                // push a copy of the metadata
                meta.push(Object.assign({}, component.metadata()));
            });
        }
        else {
            this._logger.error(`Invalid registry requested ${collection}`);
        }
        return meta;
    }
}
ComponentRegistry.COMPONENT_DIR = constants_1.CONSTANTS.DEFAULT_COMPONENT_DIR;
exports.ComponentRegistry = ComponentRegistry;
/**
 * get full path in fs.
 * @param cwd - absolute path
 * @param dirname - a directory or file string
 */
function fullPath(cwd, dirname) {
    return ~dirname.indexOf(cwd) ? dirname : path.join(cwd, dirname);
}
/**
 * wrap a raw Object in a function.
 * @desc converts module.exports = {} to a prototyped object
 * @param type - component reference object
 */
function makeCtor(type) {
    return (definitions_1.isType(type) && type) || (function LegacyComponentWrapper() {
        return type;
    });
}
/**
 * test for class decorated with @Component
 * @param ref class or object from exports.
 * @todo create a decorator factory to test annotations against instanceof
 */
function isComponent(ref) {
    return (definitions_1.isType(ref) && definitions_1.isType(ref.prototype.metadata) && definitions_1.isType(ref.prototype.invoke)) || // class usage
        (typeof ref === 'object' && definitions_1.isType(ref.metadata) && definitions_1.isType(ref.invoke)); // legacy
}
//# sourceMappingURL=registry.js.map