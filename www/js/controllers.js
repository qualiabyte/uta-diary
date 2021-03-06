angular.module('diary.controllers', [])

.filter('renderMarkdown', function() {
  return function(text) {
    var converter = new showdown.Converter();
    var html = converter.makeHtml(text);
    return html;
  }
})

.controller('RootCtrl', function($scope) {
  $scope.$on('$ionicView.afterEnter', function(ev, data){
    document.title = "Uta Diary";
    ev.stopPropagation();
  });
})

.controller('TabCtrl', function($scope, Uta) {
  $scope.$on('$ionicView.afterEnter', function(ev, data){
    document.title = "Uta Diary";
    ev.stopPropagation();
  });
})

.controller('SplashCtrl', function($scope, $state, $timeout, Uta, Init) {
  $scope.$on('$ionicView.afterEnter', function(ev, data){
    document.title = "Uta Diary";
    ev.stopPropagation();
  });

  Init.initSplashScreen().finally(function() {
    console.log("Leaving splash screen!");
    $state.go('root.login');
  });
})

.controller('IntroCtrl', function($scope, $state, $ionicSlideBoxDelegate, Uta) {
  $scope.startApp = function() {
    $state.go('tab.journal');
  };

  $scope.next = function() {
    $ionicSlideBoxDelegate.next();
  };

  $scope.previous = function() {
    $ionicSlideBoxDelegate.previous();
  };

  $scope.slideChanged = function(index) {
    $scope.slideIndex = index;
  };

  $scope.finishTutorial = function() {
    Uta.db.events.completeTutorial = new Date();
    Uta.db.settings.enableTutorial = false;
    Uta.commit(function(err) {
      $state.go('tab.journal');
    });
  };
})

.controller('StartCtrl', function($scope, $state, Uta, Init) {
})

.controller('PassphraseCtrl', function($http, $scope, $state, Uta, Crypto, KeyRing) {
  var form = $scope.form = {
    currentPassphrase: '',
    passphrase: '',
    confirmation: ''
  };
  $scope.suggestion = '';
  $scope.suggest = {
    min: 1,
    max: 9,
    count: 9
  };
  $scope.suggestionWords = [];
  $scope.suggestionHTML = '';
  $scope.formErrors = [];
  $scope.wordlist = [];
  $scope.tokens = [];
  $scope.dictionary = {};
  $scope.requireCurrentPassphrase =
    Uta.db.settings.enableEncryption &&
    Uta.db.events.createPassphrase;

  $scope.init = function() {
    $scope.loadWordlist();
    $scope.validateStrength();
  };

  $scope.loadWordlist = function() {
    $http.get("templates/wordlist.txt").then(function(response) {
      $scope.wordlist = response.data.split(/\n/g);
      $scope.tokens = [].concat($scope.wordlist);

      for (var i = 0; i < $scope.wordlist.length; i++) {
        $scope.dictionary[$scope.wordlist[i]] = true;
      }
    });
  };

  $scope.validateStrength = function(entropy) {
    $scope.pbkdfRounds = 1e4;
    // Hashrate for Nvidia Titan X: ~2.4 GH/s (SHA-256)
    // https://gist.github.com/epixoip/63c2ad11baf7bbd57544
    $scope.gpuHashrate = 2.4e9;
    $scope.strength = zxcvbn(form.passphrase, $scope.tokens);
    $scope.entropy = entropy
      ? entropy
      : Math.max(0, Math.log2(2 * ($scope.strength.guesses - 1)));
    $scope.refineEntropyEstimate();
    $scope.guesses = entropy
      ? 1 + 0.5 * Math.pow(2, entropy)
      : $scope.strength.guesses;
    $scope.guessesPerSecond = $scope.gpuHashrate / $scope.pbkdfRounds;
    $scope.secondsToCrack = $scope.guesses / $scope.guessesPerSecond;
    $scope.yearsToCrack = $scope.secondsToCrack / (3600 * 24 * 365);
    $scope.yearsScientific = $scope.yearsToCrack.toPrecision(3)
      .replace(/e\+/, " ⨉ 10<sup>") + "</sup> years";
    $scope.timeToCrack = $scope.secondsToCrack <= 1
      ? "1 second or less"
      : $scope.yearsToCrack < 1e9
      ? moment.duration(1000 * $scope.secondsToCrack).humanize()
      : $scope.yearsScientific;
  };

  $scope.refineEntropyEstimate = function() {
    var estimate = $scope.entropy;
    var words = form.passphrase.split(/ +/g);

    var isSuggestion = true;

    if (words.length == 0 || words == "")
      isSuggestion = false;

    for (var i = 0; i < words.length; i++) {
      if (! $scope.dictionary[words[i]])
        isSuggestion = false;
    }

    if (isSuggestion == true)
      $scope.entropy = words.length * Math.log2($scope.wordlist.length);
    else
      $scope.entropy = estimate;
  };

  $scope.suggestPassphrase = function() {
    var totalWords = $scope.wordlist.length;
    var wordCount = $scope.suggest.max;
    var words = [];
    var values = new Uint32Array(wordCount);
    window.crypto.getRandomValues(values);

    for (var i = 0; i < wordCount; i++) {
      var index = values[i] % totalWords;
      var word = $scope.wordlist[index];
      words.push(word);
    }

    $scope.suggestionWords = words;
    $scope.renderSuggestion();
  };

  $scope.renderSuggestion = function() {
    var totalWords = $scope.wordlist.length;
    var words = $scope.suggestionWords.slice(0, $scope.suggest.count);
    var entropy = words.length * Math.log2(totalWords);
    $scope.validateStrength(entropy);
    $scope.suggestionHTML = words.join(' ').replace(/(\w+ \w+ \w+)/g, '$1<br>');
  };

  $scope.validate = function() {
    if ($scope.requireCurrentPassphrase &&
        form.currentPassphrase != Uta.keyRing.passphrase)
      return new Error("Current passphrase must match your existing passphrase");

    if (form.confirmation != form.passphrase)
      return new Error("Passphrase and confirmation must match!");
  };

  $scope.submit = function() {
    var error = $scope.validate();
    if (error)
      return $scope.fail("Failed validation", error);

    var salt = Crypto.generateSalt(16);
    KeyRing.create(form.passphrase, salt)
    .then(
      function(keyRing) {
        console.log("Creating key ring...");
        Uta.keyRing = keyRing;
      }
    )
    .then(
      function() {
        console.log("Creating vault...");
        Uta.db.events.createPassphrase = new Date();
        Uta.db.settings.enableEncryption = true;
        Uta.commit(
          function(err) {
            if (err) {
              var error = new Error("Failed creating vault: " + err.message);
              return $scope.fail("Failed creating vault", error, err);
            }
            return $scope.success();
          }
        );
      }
    )
    .catch(
      function(err) {
        var error = new Error("Failed creating passphrase: " + err.message);
        return $scope.fail("Failed creating passphrase", error, err);
      }
    );
  };

  $scope.success = function() {
    document.getElementsByName('passphrase')[0].type = 'password';
    document.getElementsByName('confirmation')[0].type = 'password';
    $state.go('root.intro');
  };

  $scope.fail = function(status, error, details) {
    console.error(status, error, details);
    $scope.formErrors = [ error ];
  };

  $scope.init();
})

.controller('LoginCtrl', function($scope, $state, Uta, KeyRing) {
  var form = $scope.form = {
    passphrase: ''
  };
  $scope.formErrors = [];

  $scope.validate = function() {
  };

  $scope.submit = function() {
    var error = $scope.validate();
    if (error)
      return $scope.fail("Failed validation", error);

    console.log("Opening vault...");
    Uta.vault.retrieve(form.passphrase)
    .then(
      function(data) {
        console.log("Updating key ring...");
        return KeyRing.create(form.passphrase, Uta.vault.storage.salt)
        .then(
          function(keyRing) {
            Uta.keyRing = keyRing;
          }
        );
      }
    )
    .then(
      function() {
        console.log("Reloading database...");
        Uta.reload(function() {
          return $scope.success();
        });
      }
    )
    .catch(
      function(details) {
        var status = "Failed decryption";
        var error = new Error("Vault decryption failed. Please check your passphrase!");
        return $scope.fail(status, error, details);
      }
    );
  };

  $scope.success = function() {
    var input = document.getElementsByName('passphrase')[0].type = 'password';
    $state.go('root.intro');
  };

  $scope.fail = function(status, error, details) {
    console.error(status, error, details);
    $scope.formErrors = [ error ];
  };
})

.controller('JournalCtrl', function($scope, Uta, Entries) {
  $scope.Uta = Uta;
  $scope.Entries = Entries;
  $scope.entries = Entries.all();
  $scope.create = function() {
    var options = {
      date: new Date(),
      title: "Title"
    };
    var entry = Entries.create(options);
    Uta.commit();
  };
  $scope.remove = function(chat) {
    Entries.remove(chat);
    Uta.commit();
  };
  $scope.$watch('Entries.all()', function() {
      $scope.entries = Entries.all();
    }
  );
})

.controller('JournalDetailCtrl', function($scope, $stateParams, Uta, Entries) {
  $scope.Entries = Entries;
  $scope.entry = Entries.get($stateParams.entryId);
})

.controller('KitsuneCtrl', function($scope, Kitsune) {
  $scope.entries = Kitsune.all();
  $scope.avatarURL = "https://pbs.twimg.com/media/CKBfWLqUkAAaD6V.png:large";
})

.controller('KitsuneDetailCtrl', function($scope, $stateParams, Kitsune) {
  $scope.entry = Kitsune.get($stateParams.kitsuneId);
  $scope.avatarURL = "https://pbs.twimg.com/media/CKBfWLqUkAAaD6V.png:large";
})

.controller('StatsCtrl', function($scope, Uta, Entries) {
  $scope.stats = Entries.getStats();
})

.controller('SettingsCtrl', function($scope, $state, Uta) {
})

.controller('ProfileCtrl', function($scope, Uta) {
  $scope.Uta = Uta;
  $scope.save = function() {
    Uta.commit();
  };
})

.controller('AdvancedCtrl', function($scope, $state, Uta) {
  $scope.Uta = Uta;
  $scope.save = function() {
    Uta.commit();
  };
})

.controller('PrivacyCtrl', function ($scope, $state, Uta) {
  $scope.Uta = Uta;
  $scope.save = function() {
    Uta.commit();
  };
  $scope.changePassphrase = function() {
    if (Uta.db.settings.enableEncryption) {
      console.log("Navigating to passphrase screen...")
      $state.go('root.passphrase');
    }
  };
  $scope.enableEncryption = function() {
    var activated = Uta.db.settings.enableEncryption;
    if (activated) {
      console.log("Will enable encryption when passphrase created...");
      Uta.db.events.createPassphrase = null;
      Uta.db.settings.enableEncryption = false;
      Uta.commit(function() {
        console.log("Navigating to passphrase screen...");
        $state.go('root.passphrase');
      });
    }
    else {
      $scope.save();
    }
  };
})

.controller('BackupsCtrl', function($scope, $ionicActionSheet, $ionicPopup, Uta, Backups) {
  $scope.Uta = Uta;
  $scope.backups = [];

  $scope.refresh = function() {
    Backups.list(function(names) {
      console.log('Backups: ' + JSON.stringify(names, null, 2));
      $scope.backups = names;
    });
  };

  $scope.refresh();

  $scope.notify = function(options) {
    $scope.alert(options);
    $scope.refresh();
  };

  $scope.alert = function(options) {
    var alertPopup = $ionicPopup.alert(options);
    alertPopup.then(function(res) {
      console.log(options.template);
    });
  };

  $scope.confirmImport = function(callback) {
    $scope.importOptions = {
      passphrase: Uta.keyRing.passphrase
    };
    var popup = $ionicPopup.show({
      title: "Import Backup",
      subTitle: "This replaces your current journals and settings. Continue?",
      template:
          '<label>'
        + '  Passphrase<br>'
        + '  <input type="password" ng-model=importOptions.passphrase>'
        + '</label>',
      scope: $scope,
      buttons: [
        {
          text: 'Cancel',
          onTap: function(e) {
            console.log("Cancelled import");
          }
        },
        {
          text: '<b>Import</b>',
          type: 'button-positive',
          onTap: function(event) {
            var options = $scope.importOptions;
            if (options) {
              console.log("Selected import options: " + JSON.stringify(options));
              return callback(options);
            }
          }
        }
      ]
    });
  };

  $scope.confirmDelete = function(callback) {
    $scope.deleteOptions = {};
    var popup = $ionicPopup.show({
      template: '',
      title: "Delete Backup",
      subTitle: "This deletes the selected backup file. Continue?",
      scope: $scope,
      buttons: [
        {
          text: 'Cancel',
          onTap: function(e) {
            console.log("Cancelled deletion");
          }
        },
        {
          text: '<b>Delete</b>',
          type: 'button-assertive',
          onTap: function(event) {
            var options = $scope.deleteOptions;
            if (options) {
              console.log("Selected delete options: " + JSON.stringify(options));
              return callback(options);
            }
          }
        }
      ]
    });
  };

  $scope.selectExportOptions = function(callback) {
    var date = new Date();
    var timestamp = date.toISOString().slice(0, 10);
    $scope.exportOptions = {
      filename: 'journal-' + timestamp + '.json',
      encrypt: Uta.db.settings.enableEncryption
    };
    var popup = $ionicPopup.show({
      template: '<input type="text" ng-model="exportOptions.filename">'
        + '<label ng-show="Uta.db.settings.enableEncryption">'
        + '  <input type="checkbox" style="margin: 8px 0; width: auto"'
        + '         ng-model="exportOptions.encrypt">'
        + '  Encrypt with passphrase'
        + '</label>',
      title: 'Backup File',
      subTitle: 'Choose a name for your backup',
      scope: $scope,
      buttons: [
        {
          text: 'Cancel',
          onTap: function(e) {
            console.log("Cancelled export");
          }
        },
        {
          text: '<b>Save</b>',
          type: 'button-positive',
          onTap: function(event) {
            var options = $scope.exportOptions;
            if (!options.filename) {
              event.preventDefault();
            } else {
              console.log("Selected export options: " + JSON.stringify(options));
              return callback(options);
            }
          }
        }
      ]
    });
  };

  $scope.export = function() {
    $scope.selectExportOptions(function(options) {
      if (options.filename) {
        var file = options.filename;
        $scope.exportBackup(file, options);
      }
      else {
        $scope.notify({ title: "Error", template: "Invalid name for backup file" });
      }
    });
  };

  $scope.importBackup = function(backup) {
    console.log("Importing backup: " + backup);
    $scope.confirmImport(function(options) {
      Uta.Backups.restore(backup, options, function(err) {
        if (err)
          $scope.notify({ title: "Error", template: "Error restoring backup " + backup + "<br>\n" + err.message });
        else
          $scope.notify({ title: "Success!", template: "Restored backup " + backup });
      });
    });
  };

  $scope.exportBackup = function(backup, options) {
    console.log("Creating backup: " + backup);
    Uta.Backups.create(backup, options, function(err) {
      if (err)
        $scope.notify({ title: "Error", template: "Error creating backup " + backup + "<br>\n" + err.message });
      else
        $scope.notify({ title: "Success!", template: "Created backup " + backup });
    });
  };

  $scope.deleteBackup = function(backup) {
    console.log("Deleting backup: " + backup);
    $scope.confirmDelete(function(options) {
      Uta.Backups.delete(backup, function(err) {
        if (err)
          $scope.notify({ title: "Error", template: "Error deleting " + backup + "<br>\n" + err.message });
        else
          $scope.notify({ title: "Success!", template: "Deleted backup " + backup });
      });
    });
  };
});
