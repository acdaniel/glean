
var crypto = require('crypto');
var path = require('path');
var url = require('url');
var express = require('express');
var debug = require('debug')('glean');
var _ = require('lodash-node');
var fs = require('node-fs');
var q = require('q');
var mime = require('mime');

var _options = {};
var _assets = {};

// main glean function 
var glean = function (options) {
  var router = express.Router();

  options = options || {};
  _.defaults(options, {
    registry: null,
    https: false,
    host: 'localhost',
    prefix: '',
    cacheBust: true,
    localsName: 'assets'
  });
  _options = options;

  // add routes for all given extensions
  for (var key in options) {
    if (key[0] === '.') {
      debug('adding route for ' + key + ' assets');
      router.get(
        new RegExp('\\' + key + '$', 'i'), 
        glean.middleware(key, options[key])
      );
    }
  }

  // load asset registry if available
  if (options.registry) {
    _assets = JSON.parse(fs.readFileSync(options.registry, 'utf8'));
  }
  
  // add wildcard route to add assets func to res.locals
  router.all('*', function (req, res, next) {
    res.locals[_options.localsName] = glean.assets;
    next();
  });

  return router;
};

// gets option that was set via the main function call or glean.set
glean.get = function (key) {
  return _options[key];
};

// sets a glean option
glean.set = function (key, value) {
  _options[key] = value;
};

// retrieves the url to the asset with the given path
glean.assets = function (path) {
  return _assets[path] ? _assets[path] : path;
};

// express middleware that handles the processing, renaming and writing of the 
// asset.
glean.middleware = function (ext, options) {
  return function (req, res, next) {
    var src = options.src || _options.src;
    var dest = options.dest || _options.dest;
    var reqPath = url.parse(req.url).pathname;
    var srcFile = path.join(src, reqPath);
    var destPath = reqPath;
    var destFile = null;
    debug('processing ' + reqPath);
    // process source
    q.nfcall(options.processor, srcFile, options)
      // write dest file if needed
      .then(function (content) {
        var deferred = q.defer();
        if (!dest) {
          deferred.resolve(content);
        } else {
          if (_options.cacheBust) {
            var md5 = crypto.createHash('md5').update(content).digest('hex');
            destPath = reqPath.substr(0, reqPath.length - ext.length) + '-' + md5 + ext;
          } 
          destFile = path.join(dest, destPath);
          q.nfcall(fs.mkdir, path.dirname(destFile), 077, true)
            .then(function () {
              return q.nfcall(fs.writeFile, destFile, content);
            })
            .then(function () {
              deferred.resolve(content);
            })
            .fail(function (err) {
              deferred.reject(err);
            });
        }
        return deferred.promise;
      })
      // send response and add file to assets registry
      .then(function (content) {
        _assets[reqPath] = 
          (_options.https ? 'https' : 'http') +
          '://' + _options.host +
          _options.prefix + destPath;
        if (!destFile) {
          debug('sending contents');
          res.type(mime.lookup(ext));
          res.status(200).send(content);
        } else {
          res.redirect(destPath, 301);
        }
      })
      // catch any errors
      .fail(function (err) {
        return next(err);
      })
      .done();
  };
};

module.exports = glean;
