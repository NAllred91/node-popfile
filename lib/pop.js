'use strict';

var EventEmitter = require('events').EventEmitter;
var mkdirp = require('mkdirp');
var path = require('path');
var util = require('util');
var _ = require('underscore');
var async = require('async');
var fs = require('fs');

function Pop(pathToFile, destination) {
    var self = this;
    if(!(this instanceof Pop)) {
        return new Pop(pathToFile, destination);
    }

    self._pathToFile = path.normalize(pathToFile);
    self._destination = path.normalize(destination);
};

util.inherits(Pop, EventEmitter);

Pop.prototype.start = function() {
    var self = this;

    var stopError;

    var onStop = function(err) {
        stopError = err;
    }

    self.on('stop', onStop);

    var fd;
    var location;
    var currentFileSize;
    var currentPath;
    var bytesOfMetaData;

    var readIntAtLocation = function(callback)
    {
        readBackwardsInt(fd, location, function(err, result)
        {
            if(err)
            {
                callback(err);
                return;
            }
            location = result.newLocation;
            callback(undefined, result.value);
        });
    };

    var readStringAtLocation = function(length, callback)
    {
        readString(fd, length, location, function(err, result)
        {
            if(err)
            {
                callback(err);
                return;
            }

            location = result.newLocation;
            callback(undefined, result.string);
        });
    };

    var makeDirectory = function(directory, callback)
    {
        directory = path.join(self._destination, directory)   
        mkdirp(directory, function(err)
        {
            callback(err);
        });
    };

    var processLocationBlock = function(location, callback)
    {
        readIntAtLocation(function(err, indicatorByte)
        {
            if(err)
            {
                callback(err);
                return;
            }

            switch(indicatorByte)
            {
                case 0:
                    async.waterfall([
                        function(callback)
                        {
                            readIntAtLocation(function(err, offset)
                            {
                                callback(err, offset);
                            });
                        },
                        function(offset, callback)
                        {
                            readIntAtLocation(function(err, nameLength)
                            {
                                callback(err, offset, nameLength);
                            });
                        },
                        function(offset, nameLength, callback)
                        {
                            readStringAtLocation(nameLength, function(err, name)
                            {
                                callback(err || stopError, offset, name);
                            });
                        },
                        function(offset, name, callback)
                        {
                            copyAndDeleteFile(name, offset, function(err)
                            {
                                callback(err);
                            });
                        }], function(err)
                        {
                            // TODO error
                            callback(err, true);
                        });
                    break;

                case 1:
                    async.waterfall([
                        function(callback)
                        {
                            readIntAtLocation(function(err, pathAdditionSize)
                            {
                                callback(err, pathAdditionSize);
                            });
                        },
                        function(pathAdditionSize, callback)
                        {
                            if(pathAdditionSize > 0)
                            {
                                readStringAtLocation(pathAdditionSize, function(err, pathAddition)
                                {
                                    callback(err, pathAddition);
                                });
                            }
                            else
                            {
                                callback(undefined, '');
                            }
                        },
                        function(pathAddition, callback)
                        {
                            readIntAtLocation(function(err, offset)
                            {
                                callback(err, pathAddition, offset);
                            });
                        },
                        function(pathAddition, offset, callback)
                        {
                            readIntAtLocation(function(err, nameLength)
                            {
                                callback(err, pathAddition, offset, nameLength);
                            });
                        },
                        function(pathAddition, offset, nameLength, callback)
                        {
                            readStringAtLocation(nameLength, function(err, name)
                            {
                                callback(err || stopError, pathAddition, offset, name);
                            });
                        },
                        function(pathAddition, offset, name, callback)
                        {
                            copyAndDeleteFile(name, offset, function(err)
                            {
                                if(err)
                                {
                                    callback(err);
                                    return;
                                }

                                if(pathAddition)
                                {
                                    var currentPathArray = currentPath.split(path.sep);
                                    currentPathArray.push(pathAddition);
                                    currentPath = path.normalize(currentPathArray.join('/'))
                                    makeDirectory(currentPath, function(err)
                                    {
                                        callback(err);
                                    });
                                }
                                else
                                {
                                    callback();
                                }
                            });
                        }], function(err)
                        {
                            callback(err, true);
                        });
                    break;

                case 2:
                    async.waterfall([
                        function(callback)
                        {
                            readIntAtLocation(function(err, pathAdditionSize)
                            {
                                callback(err, pathAdditionSize);
                            });
                        },
                        function(pathAdditionSize, callback)
                        {
                            if(pathAdditionSize > 0)
                            {
                                readStringAtLocation(pathAdditionSize, function(err, pathAddition)
                                {
                                    callback(err, pathAddition);
                                });
                            }
                            else
                            {
                                callback(undefined, '');
                            }
                        },
                        function(pathAddition, callback)
                        {
                            readIntAtLocation(function(err, levelsUp)
                            {
                                callback(err, pathAddition, levelsUp);
                            });
                        },
                        function(pathAddition, levelsUp, callback)
                        {
                            readIntAtLocation(function(err, offset)
                            {
                                callback(err, pathAddition, levelsUp, offset);
                            });
                        },
                        function(pathAddition, levelsUp, offset, callback)
                        {
                            readIntAtLocation(function(err, nameLength)
                            {
                                callback(err, pathAddition, levelsUp, offset, nameLength);
                            });
                        },
                        function(pathAddition, levelsUp, offset, nameLength, callback)
                        {
                            readStringAtLocation(nameLength, function(err, name)
                            {
                                callback(err || stopError, pathAddition, levelsUp, offset, name);
                            });
                        },
                        function(pathAddition, levelsUp, offset, name, callback)
                        {
                            copyAndDeleteFile(name, offset, function(err)
                            {
                                var currentPathArray = currentPath.split(path.sep)
                                currentPathArray = _.first(currentPathArray, currentPathArray.length - levelsUp);
                                if(pathAddition)
                                {
                                    currentPathArray.push(pathAddition);
                                    currentPath = path.normalize(currentPathArray.join('/'))
                                    makeDirectory(currentPath, function(err)
                                    {
                                        callback(err);
                                    })
                                }
                                else
                                {
                                    currentPath = path.normalize(currentPathArray.join('/'));
                                    callback();
                                }
                            });
                        }], function(err)
                        {
                            // TODO error
                            callback(err, true);
                        });
                    break;
                
                case 3:

                    async.waterfall([
                        function(callback)
                        {
                            readIntAtLocation(function(err, offset)
                            {
                                callback(err, offset);
                            });
                        },
                        function(offset, callback)
                        {
                            readIntAtLocation(function(err, nameLength)
                            {
                                callback(err, offset, nameLength);
                            });
                        },
                        function(offset, nameLength, callback)
                        {
                            readStringAtLocation(nameLength, function(err, name)
                            {
                                callback(err || stopError, offset, name);
                            });
                        },
                        function(offset, name, callback)
                        {
                            copyAndDeleteFile(name, offset, function(err)
                            {
                                callback(err);
                            });
                        }], function(err)
                        {
                            callback(err, false);
                        });
                    break;

                default: callback(new Error("Invalid pop file."));
            }
        })
    };

    var copyAndDeleteFile = function(fileName, offset, callback)
    {
        offset = offset + bytesOfMetaData;
        if(currentFileSize < offset)
        {
            callback();
            return;
        }

        var thisFileSize = currentFileSize - offset;
        var buffer = new Buffer(thisFileSize);
        
        if(thisFileSize === 0)
        {
            fs.writeFile(path.join(self._destination,currentPath, fileName), '', function(err)
                {
                    callback(err);
                });
            return;
        }
        var read = fs.createReadStream(undefined, {
            fd: fd,
            start: offset,
            end: offset + thisFileSize,
            autoClose: false
        })

        var out = fs.createWriteStream(path.join(self._destination,currentPath, fileName));

        read.pipe(out).
        on('close', function()
        {
            fs.truncateSync(self._pathToFile, currentFileSize - thisFileSize);
            currentFileSize = currentFileSize - thisFileSize;
            callback();
        });
    };

    async.series([
        function(callback)
        {
            fs.open(self._pathToFile, 'r', function(err, newFd)
            {
                fd = newFd;
                callback(err);
            });
        },
        function(callback)
        {
            validateStartingBytes(fd, function(err)
            {
                callback(err);
            });
        },
        function(callback)
        {
            getBytesOfMetaData(fd, function(err, newLocation)
            {
                location = newLocation;
                bytesOfMetaData = newLocation;
                callback(err);
            });
        },
        function(callback)
        {
            fs.stat(self._pathToFile, function(err, stats)
            {
                if(stats)
                {
                    currentFileSize = stats.size;
                }

                callback(err);
            });
        },
        function(callback)
        {
            readIntAtLocation(function(err, junkByteOffset)
            {
                if(err)
                {
                    callback(err);
                    return;
                }

                readIntAtLocation(function(err, junkBytes)
                {
                    if(err)
                    {
                        callback(err);
                        return;
                    }

                    if(currentFileSize >= junkByteOffset + junkBytes)
                    {
                        currentFileSize = currentFileSize - junkBytes;
                        fs.truncate(self._pathToFile, currentFileSize, function(err)
                            {
                                callback(err);
                            });
                    }
                    else
                    {
                        callback();
                    }
                });
            });
        },
        function(callback)
        {
            readIntAtLocation(function(err, currentPathStringLength)
            {
                if(err)
                {
                    callback(err);
                    return;
                }

                readStringAtLocation(currentPathStringLength, function(err, newCurrentPath)
                {
                    currentPath = newCurrentPath;
                    callback(err);
                });
            });
        },
        function(callback)
        {
            makeDirectory(currentPath, function(err)
            {
                callback(err);
            });
        },
        function(callback)
        {
            var keepGoing = true;

            async.whilst(
                function(){ return keepGoing; },
                function(callback)
                {
                    processLocationBlock(location, function(err, newKeepGoing)
                    {
                        keepGoing = newKeepGoing;
                        callback(err || stopError);
                    });
                },
                function(err)
                {
                    fs.unlink(self._pathToFile, function(unlinkErr)
                        {
                            callback(err || unlinkErr);
                        });
                });
        }], function(err)
        {
            if(err)
            {
                self.emit('error', err);
            }
            else
            {
                self.emit('finish');
            }
        });
};

// Call this function to cancel the pop process.
Pop.prototype.stop = function() {
    this.emit('stop', new Error("Pop process canceled."));
};

var validateStartingBytes = function(fd, callback) {
    var buffer = new Buffer(5);
    fs.read(fd, buffer, 0, 5, 0, function(err, bytesRead, buffer)
        {
            if(buffer.toString() !== "pop01")
            {
                err = err || new Error("Invalid pop file.");
            }
            callback(err)
        });
};

var readBackwardsInt = function(fd, location, callback) {
    var keepReading = true;
    var hasHit = false;
    var result = 0;
    var place = 1;
    var base = 255;

    var readNextByte = function(callback)
    {
        var buffer = new Buffer(1);
        fs.read(fd, buffer, 0, 1, location, function(err, bytesRead, buffer)
            {
                if(err)
                {
                    callback(err);
                    return;
                }
                
                location = location - 1;
                var Byte = buffer.readUInt8(0) - 1;
                if(Byte !== -1)
                {
                    result = result + (Byte * place);
                    place = place * base;
                    hasHit = true;
                    callback(undefined, true);
                }
                else
                {
                    callback(undefined, hasHit?false:true);
                }
            });
    };

    async.whilst(
        function(){ return keepReading; },
        function(callback)
        {
            readNextByte(function(err, newKeepReading)
            {
                if(err)
                {
                    callback(err);
                    return;
                }

                keepReading = newKeepReading;

                callback();
            });
        },
        function(err)
        {
            callback(err, {
                    newLocation: location,
                    value: result
                });
        });
};

var readString = function(fd, length, location, callback)
{
    if(length)
    {
        var buffer = new Buffer(length);
        fs.read(fd, buffer, 0, length, location - length + 1, function(err, bytesRead, buffer)
            {
                if(err)
                {
                    callback(err);
                    return;
                }

                callback(undefined, 
                {
                    newLocation: location - length - 1,
                    string: buffer.toString()
                });
            });
    }
    else
    {
        callback(undefined, {
            newLocation: location,
            string: ''
        });
    } 
}

var getBytesOfMetaData = function(fd, callback)
{
    readBackwardsInt(fd, 64 + 4/*ish?*/, function(err, result)
        {
            if(err)
            {
                callback(err);
                return;
            }

            callback(undefined, result.value);
        });
};

module.exports = Pop;