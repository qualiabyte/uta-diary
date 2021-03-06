
angular.module('diary.services')

.factory('KeyRing', function($q, Crypto) {

  var Uta = null;

  /**
   * The KeyRing class holds a user's secret keys,
   * allowing for cryptographic operations after entering
   * their passphrase once each time the app is started.
   *
   * This sensitive information is stored only in memory,
   * rather than persisted to the filesystem with other data.
   *
   * Example:
   *
   *    // Create a new key ring
   *    KeyRing.create(passphrase, salt).then(
   *      function(keyRing) {
   *        var pass          = keyRing.passphrase;
   *        var salt          = keyRing.salt;
   *        var parentKey     = keyRing.keys.parentKey;
   *        var encryptionKey = keyRing.keys.encryptionKey;
   *        var signingKey    = keyRing.keys.signingKey;
   *      }
   *    );
   *
   */
  var KeyRing = function() {};

  // Creates a new key ring from passphrase and salt.
  KeyRing.create = function(passphrase, salt) {
    console.log("Creating key ring...");
    var keyRing = new KeyRing();
    var promise = keyRing.configure(passphrase, salt);
    return promise;
  };

  KeyRing.prototype = {

    constructor: KeyRing,
    passphrase: null,
    salt: null,
    keys: null,

    // Configures this key ring with passphrase and salt.
    configure: function(passphrase, salt) {
      console.log("Configuring key ring...");
      var q = $q.defer();
      var self = this;

      console.log("Deriving keys...");
      Crypto.deriveKeys(passphrase, salt, function(err, keys) {
        if (err) {
          console.log("Failed deriving keys: " + err.message);
          return q.reject(err);
        }

        self.passphrase = passphrase;
        self.salt = salt;
        self.keys = keys;

        return q.resolve(self);
      });
      return q.promise;
    }
  };

  // Initialises the module.
  KeyRing.init = function(uta) {
    Uta = uta;
    return this;
  };

  return KeyRing;
})

.factory('Uta', function($cordovaFile, $q, Backups, Crypto, Database, Entries, FileUtils, KeyRing, Markov, Test, Vault) {

  var Uta = {

    // The Uta Diary database.
    db: {},

    // The external storage directory.
    externalStorageDirectory: "",

    // Gets the directory for application data.
    getDataDirectory: function() {
      if (ionic.Platform.isAndroid()) {
        return cordova.file.dataDirectory;
      }
    },

    // Refreshes the external storage directory.
    refreshExternalStorage: function(callback) {
      if (ionic.Platform.isAndroid()) {
        Uta.getExternalStorage(
          function(err, result) {
            if (err) {
              console.log("Failed refreshing external storage: " + err.message);
              return callback(err);
            }
            else {
              console.log("Found external storage directory: " + result);
              Uta.externalStorageDirectory = result;
              return callback(null);
            }
          }
        );
      }
      else {
        return callback(null);
      }
    },

    // Gets external storage directory.
    getExternalStorage: function(callback) {
      console.log("Getting external storage directory...");

      console.log("Checking for cordova external root...");
      var cordovaRoot = cordova.file.externalRootDirectory;
      if (cordovaRoot) {
        return callback(null, cordovaRoot);
      }

      console.log("Checking for sdcards...");
      var storageRoot = 'file:///storage/';
      var sdcard1 = 'sdcard1/';
      var sdcard0 = 'sdcard0/';

      console.log("Checking for sdcard1...");
      $cordovaFile.checkDir(storageRoot, sdcard1)
      .then(
        function(success) {
          return callback(null, storageRoot + sdcard1)
        },
        function(error) {
          console.log("Checking for sdcard0...");
          $cordovaFile.checkDir(storageRoot, sdcard0)
          .then(
            function(success) {
              return callback(null, storageRoot + sdcard0);
            },
            function(error) {
              return callback(new Error("Failed finding external storage"));
            }
          );
        }
      );
    },

    // Gets root of the directory for backups.
    getBackupRoot: function() {
      return Uta.externalStorageDirectory;
    },

    // Gets parent of the directory for backups.
    getBackupParent: function() {
      return Uta.getBackupRoot() + 'UtaDiary/';
    },

    // Gets the directory for database backups.
    getBackupDirectory: function() {
      return Uta.getBackupParent() + 'backups/';
    },

    // Creates backup directories.
    createBackupDirs: function() {
      var q = $q.defer();
      console.log("Creating backup directories");
      $cordovaFile.createDir(Uta.getBackupRoot(), 'UtaDiary', true)
      .then(
        function(success) {
          return $cordovaFile.createDir(Uta.getBackupParent(), 'backups', true)
        }
      )
      .then(
        function() {
          return q.resolve();
        }
      )
      .catch(
        function(error) {
          return q.reject(new Error("Error creating backup directories: " + error.message));
        }
      );
      return q.promise;
    },

    // Reloads the database.
    reload: function(callback) {
      Uta.loadData()
      .then(
        function(json) {
          return Uta.loadJSON(json, callback);
        }
      )
      .catch(
        function(error) {
          return callback(new Error("Failed reloading database: " + error.message));
        }
      );
    },

    // Commits the database.
    commit: function(callback) {
      callback = callback || function() {};

      if (!Database.validateDB(Uta.db)) {
        var message = "Failed committing database: Database validation failed";
        var error = new Error(message);
        console.warn(error.message);
        return callback(error);
      }

      Uta.db.lastWrittenAt = new Date();
      Uta.serialize()
      .then(
        function(json) {
          return Uta.saveData(json);
        }
      )
      .then(
        function() {
          return callback(null);
        }
      )
      .catch(
        function(error) {
          return callback(new Error("Failed commiting database: " + error.message));
        }
      );
    },

    // Serializes the database for storage.
    serialize: function(options) {
      var options = options || {};
      var useEncryption = options.encrypt != undefined
        ? options.encrypt
        : Uta.db.settings.enableEncryption;

      if (useEncryption)
        return Uta.serializeVault();
      else
        return Uta.serializeDB();
    },

    // Serializes the non-encrypted database for storage.
    serializeDB: function() {
      var q = $q.defer();
      var json = angular.toJson(Uta.db);
      q.resolve(json);
      return q.promise;
    },

    // Serializes the encrypted database for storage.
    serializeVault: function() {
      var q = $q.defer();
      var vault = new Vault();
      var passphrase = Uta.keyRing.passphrase;
      var data = Uta.db;
      vault.store(passphrase, data)
      .then(
        function() {
          var json = vault.serialize();
          return q.resolve(json);
        }
      )
      .catch(
        function(error) {
          return q.reject(new Error("Failed serializing vault: " + error.message));
        }
      );
      return q.promise;
    },

    // Loads application data.
    loadData: function() {
      if (window.cordova) {
        return Uta.readFile(Uta.getDataDirectory(), "entries.json");
      }
      else {
        return Uta.readLocalStorage("diaryDB");
      }
    },

    // Saves application data.
    saveData: function(data) {
      var isMobile = window.cordova;
      if (isMobile) {
        var path = Uta.getDataDirectory();
        var file = "entries.json";
        return Uta.writeFile(path, file, data);
      }
      else {
        var key = "diaryDB";
        return Uta.writeLocalStorage(key, data);
      }
    },

    // Reads data from the file system.
    readFile: function(path, filename) {
      console.debug("Reading file '" + filename + "' at path '" + path + "'");
      return $cordovaFile.readAsText(path, filename)
      .then(
        function(data) {
          return data;
        }
      )
      .catch(
        function(error) {
          console.debug("Failed reading file: ", error);
          return new Error("Failed reading file: " + error.message);
        }
      );
    },

    // Reads data from local storage.
    readLocalStorage: function(key) {
      var q = $q.defer();
      var data = window.localStorage[key];
      q.resolve(data);
      return q.promise;
    },

    // Writes data to the file system.
    writeFile: function(path, filename, data) {
      return FileUtils.writeFileAsync(path, filename, data, true);
    },

    // Writes data to local storage.
    writeLocalStorage: function(key, data) {
      var q = $q.defer();
      window.localStorage[key] = data;
      q.resolve();
      return q.promise;
    },

    // Loads JSON for database or vault.
    loadJSON: function(json, options, callback) {
      if (arguments.length == 2) {
        callback = options;
        options = {};
      }

      console.log("Loading JSON: " + json);
      var data = angular.fromJson(json);
      var isVault = data.vault ? true : false;

      if (isVault) {
        var vault = new Vault();
        vault.deserialize(json);
        Uta.loadVault(vault, options, callback);
      }
      else {
        Uta.importDB(data, callback);
      }
    },

    // Loads database from a vault.
    loadVault: function(vault, options, callback) {
      if (arguments.length == 2) {
        callback = options;
        options = {};
      }

      var passphrase = _.isString(options.passphrase)
        ? options.passphrase
        : Uta.keyRing.passphrase;

      console.log("Loading vault: " + vault);
      vault.retrieve(passphrase)
      .then(
        function(data) {
          Uta.importDB(data, callback);
        }
      )
      .catch(
        function(err) {
          return callback(new Error("Failed loading vault: " + err.message));
        }
      );
    },

    // Imports a database file.
    importFile: function(path, file, options, callback) {
      console.log("Importing file: " + file);

      $cordovaFile.readAsText(path, file).then(
      function(json) {
        console.log("Imported JSON: " + json);

        Uta.loadJSON(json, options, function(err) {
          if (err)
            return callback(new Error("Error importing file: " + err.message));
          else
            return callback(null);
        });
      },
      function(error) {
        return callback(new Error("Error reading file: " + JSON.stringify(error, null, '  ')));
      });
    },

    // Imports a database object.
    importDB: function(database, callback) {
      console.log("Importing database: " + JSON.stringify(database, null, '  '));
      callback = callback || function() {};

      var isValid = Database.validateDB(database);
      if (isValid) {
        Uta.db = database;
        return Uta.commit(callback);
      }
      else {
        return callback(new Error("Invalid database"));
      }
    },

    // Exports database to file.
    exportFile: function(path, file, options, callback) {
      console.log("Exporting file: " + file);
      Uta.createBackupDirs()
      .then(
        function() {
          return Uta.serialize(options);
        }
      )
      .then(
        function(data) {
          return FileUtils.writeFile(path, file, data, true, callback);
        }
      )
      .catch(
        function(error) {
          return callback(new Error("Failed exporting file: " + error.message));
        }
      );
    },

    // Deletes a given file.
    deleteFile: function(path, file, callback) {
      console.log("Deleting file: " + file);
      $cordovaFile.removeFile(path, file).then(
        function(success) {
          return callback(null);
        },
        function(error) {
          return callback(new Error("Error deleting file: " + JSON.stringify(error)));
        }
      );
    },

    // Migrates database up to latest version.
    migrateUp: function(callback) {
      var lastMigration = Uta.db.lastMigration;
      var latestMigration = Uta.Database.migrations.slice(-1)[0];

      console.log("Current database version: " + lastMigration.version);

      if (lastMigration.id < latestMigration.id) {
        console.log("Upgrading database to version: " + latestMigration.version);
        Uta.Database.migrateUp(Uta.db, latestMigration.id);
        return Uta.commit(callback);
      }
      else {
        console.log("Database is up-to-date");
        return callback(null);
      }
    }
  };

  Uta.Backups = Backups.init(Uta);
  Uta.Crypto = Crypto.init(Uta);
  Uta.Entries = Entries.init(Uta);
  Uta.Database = Database.init(Uta);
  Uta.KeyRing = KeyRing.init(Uta);
  Uta.Markov = Markov.init(Uta);
  Uta.Test = Test.init(Uta);
  Uta.Vault = Vault.init(Uta);

  window.Uta = Uta;
  return Uta;
});
