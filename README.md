# node-popfile
See https://github.com/NAllred91/.pop-Documentation/wiki for documentation on the .pop file format.

# Usage
### Bubbling
```javascript
var popfile = require('popfile');

var bubbler = popfile.bubble('<path of directory to bubble>', '<path to place .pop>');

bubbler.on('error', function(err)
{
    // Handle the error.
});

bubbler.on('finish', function()
{
    // The .pop file now exists.
});

// Start the bubble process.
bubbler.start();
```

The bubble process can also be cancelled once it has been started.  This will cause an error to be emitted.
```javascript
bubbler.stop()
```

###Popping
```javascript
var popfile = require('popfile');
var popper = popfile.pop('<path to .pop>', '<path to pop to>');

popper.on('error', function(err)
{
    // Handle the error.
});

popper.on('finish', function()
{
    // The .pop file has been popped.
});

popper.on('paused', function()
{
    /** 
        The popping process has been paused.
        Calling .start() will start the process again.
        The .pop file can also be popped at a later time,
        just make sure to pop it to the same place if you
        want your files to stay together.
    **/
});

popper.start();
```

The popping process can be stopped once it has been started.  This will cause the pause event to fire.
```javascript
popper.stop();
```
