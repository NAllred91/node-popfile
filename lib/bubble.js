'use strict';

var EventEmitter = require('events').EventEmitter;
var _ = require('underscore');
var async = require('async');
var util = require('util');
var path = require('path');
var fs = require('fs');

function Bubble(directoryToBubble, destination) {
	var self = this;
	if(!(this instanceof Bubble)) {
		return new Bubble(directoryToBubble, destination);
	}

	self._directoryToBubble = directoryToBubble;
	self._popFileName = path.normalize(destination) + '/test.pop';
};

util.inherits(Bubble, EventEmitter);

Bubble.prototype.start = function() {
	var self = this;

	var stopError;

	var onStop = function(err) {
		stopError = err;
	}

	self.on('stop', onStop);

	fs.watch(
		self._directoryToBubble,
		{ persistent: false, recursive: true}, 
		function(activity, file) {
			var error = new Error("Directory changed during bubbling.");
			error.file = file;
			error.activity = activity;
			self.emit('stop', error);
		});

	var infoObject = {
		totalBytesOfMetaData: 0,
		totalContainerLength: 0,
		lastLocation: undefined,
		largestFileSize: 0,
		levelsAbove: path.normalize(self._directoryToBubble).split(path.sep).length - 1
	};

	async.series([
		function(callback) {
			openFile(self._popFileName, function(err, fd) {
				infoObject.fd = fd;

				callback(err || stopError);
			});
		},
		function(callback) {
			startMetaData(infoObject.fd, function(err, bytes) {
				if(bytes) {
					infoObject.totalBytesOfMetaData += bytes;
				}

				callback(err || stopError);
			});
		},
		function(callback) {
			walk(
				self,
				infoObject, 
				self._directoryToBubble, 
				writeLocationBlock,
				function(err, newInfoObject) {
					infoObject = newInfoObject;
					callback(err || stopError);
				});
		},
		function(callback) {
			writeTailEnd(infoObject, function(err, bytes) {
				if(bytes) {
					infoObject.totalBytesOfMetaData += bytes;
				}

				callback(err || stopError);
			});
		},
		function(callback) {
			var bytesOfMetaDataBuffer = getBufferForNumber(infoObject.totalBytesOfMetaData);
			fs.write(
				infoObject.fd, 
				bytesOfMetaDataBuffer, 
				0, 
				bytesOfMetaDataBuffer.length, 
				6, 
				function(err) {
					callback(err || stopError);
				});
		},
		function(callback) {
			infoObject.writeStream = fs.createWriteStream(undefined, {
				flags: 'a',
				fd: infoObject.fd,
				autoClose: false
			})
			.on('error', function(err) {
				self.emit('stop', err);
			});

			walk(
				self,
				infoObject, 
				self._directoryToBubble, 
				writeToContainer, 
				function(err, newInfoObject) {
					infoObject = newInfoObject;
					callback(err || stopError);
				});
		},
		function(callback) {
			fs.appendFile(
				self._popFileName, 
				new Buffer(infoObject.largestFileSize).fill('\0'), 
				function(err) {
					callback(err || stopError);
				});				
		}], function(err) {
			self.removeListener('stop', onStop);

			if(infoObject.writeStream) {
				infoObject.writeStream.close();
			}

			if(err) {
				fs.unlink(self._popFileName, function() {
					self.emit('error', err);
				});
				return;
			}

			self.emit('finish');
		});
};

// Call this function to cancel the bubble process.
Bubble.prototype.stop = function() {
	this.emit('stop', new Error("Bubble process canceled."));
};

// Recursively iterate through the directory.
// Actions are only performed on files.
var walk = function(self, infoObject, dir, action, callback) {
	var stopError;

	var onStop = function(err) {
		stopError = err;
	};

	self.once('stop', onStop);

	fs.readdir(dir, function(err, list) {
		if(err || stopError) {
			callback(err || stopError);
			return;
		}

		if(list.length === 0) {
			action(self, infoObject, 0, dir, '', 
				function(err, newInfoObject) {
					infoObject = newInfoObject;
					callback(err || stopError, newInfoObject);
				});
			return;
		}

		async.eachSeries(list, function(file, callback) {
			if(!file) {
				callback(stopError);
				return;
			}

			var location = path.join(dir, file)
			fs.stat(location, function(err, stat) {
					if(err || stopError) {
						callback(err || stopError);
						return;
					}

					if (stat && stat.isDirectory()) {
						walk(
							self,
							infoObject, 
							location, 
							action, 
							function(err, newInfoObject) {
								infoObject = newInfoObject;
								callback(err || stopError);
							});	
					} 
					else {
						action(self,
							infoObject, 
							stat.size, 
							dir, 
							file, 
							function(err, newInfoObject) {			
								infoObject = newInfoObject;
								callback(err || stopError);
							});
					}
				});
		}, function(err) {
			self.removeListener('stop', onStop);

			callback(err, infoObject)
		});
	});
};

var writeToContainer = function(self, infoObject, size, location, fileName, callback) {
	var readStream = fs.createReadStream(path.join(location, fileName));

	readStream.on('error', 
		function(err) {
			// This is an empty directory... maybe a better way to do this, maybe not.
			if(err.errno === -21) {
				err = undefined;
			}

			callback(err, infoObject);
		}).on('end', 
		function() {
			callback(undefined, infoObject);
		});

	readStream.pipe(infoObject.writeStream, {end: false});
};

var writeLocationBlock = function(self, infoObject, size, location, fileName, callback) {
	var stopError;

	var onStop = function(err) {
		stopError = err;
	}

	self.once('stop', onStop);

	var totalBytesOfMetaData = infoObject.totalBytesOfMetaData;
	var totalContainerLength = infoObject.totalContainerLength;
	var lastLocation = infoObject.lastLocation;
	var largestFileSize = infoObject.largestFileSize;
	var fd = infoObject.fd;
	var levelsAbove = infoObject.levelsAbove;

	if(size > largestFileSize) {
		largestFileSize = size;
	}

	// All of the write operations for this block will
	// be put into this array.
	var writeOps = [
		writeNullByte(fd),
		writeString(fd, fileName),
		writeNullByte(fd),
		writeBackwardsInt(fd, fileName.length),
		writeNullByte(fd),
		writeBackwardsInt(fd, totalContainerLength),
		writeNullByte(fd)
	];

	totalContainerLength += size;

	if(!lastLocation) {
		// 0 Bytes here for new level.
		writeOps.push(writeNullByte(fd));
		writeOps.push(writeBackwardsInt(fd, 3));
		lastLocation = path.normalize(_.rest(location.split(path.sep), levelsAbove).join('/'));
	}
	else {
		location =  path.normalize(_.rest(location.split(path.sep), levelsAbove).join('/'))
		var indicatorInfo = determineIndicatorByte(location, lastLocation);

		lastLocation = location;

		switch(indicatorInfo.indicator) {
			case 0:
				// 0 Bytes here for how many levels up
				writeOps.push(writeNullByte(fd));
				// 0 Bytes here for new stuff
				writeOps.push(writeNullByte(fd));
				// 0 Bytes here for new stuff length
				writeOps.push(writeNullByte(fd));
				writeOps.push(writeBackwardsInt(fd, 0));
				break;

			case 1:
				// 0 Bytes here for how many levels up
				writeOps.push(writeNullByte(fd));
				if(indicatorInfo.newStuff.length > 0) {
					writeOps.push(writeString(fd, indicatorInfo.newStuff));
					writeOps.push(writeNullByte(fd));
					writeOps.push(writeBackwardsInt(fd, indicatorInfo.newStuff.length));
				}
				else {
					writeOps.push(writeBackwardsInt(fd, 0));
				}
				
				writeOps.push(writeNullByte(fd));
				writeOps.push(writeBackwardsInt(fd, 1));
				break;

			case 2:
				writeOps.push(writeBackwardsInt(fd, indicatorInfo.levelsUp));
				writeOps.push(writeNullByte(fd));

				if(indicatorInfo.newStuff.length > 0) {
					writeOps.push(writeString(fd, indicatorInfo.newStuff));
					writeOps.push(writeNullByte(fd));
					writeOps.push(writeBackwardsInt(fd, indicatorInfo.newStuff.length));
				}
				else {
					writeOps.push(writeBackwardsInt(fd, 0));
				}
				writeOps.push(writeNullByte(fd));
				writeOps.push(writeBackwardsInt(fd, 2));
				break;

			default: 
				callback(new Error("Invalid File."));
				return;
		}
	}

	async.waterfall(writeOps, function(err, byteCount) {	
		self.removeListener('stop', onStop);

		callback(err || stopError, 
		{
			totalBytesOfMetaData: totalBytesOfMetaData + byteCount,
			totalContainerLength: totalContainerLength,
			lastLocation: lastLocation,
			largestFileSize: largestFileSize,
			levelsAbove: levelsAbove,
			fd: fd
		});
	});
};

var getBufferForNumber = function(number) {
	var base = 255;
	var place = 1;
	var max = 255
	var numberOfBytes = 1;
	while(number > max) {
		numberOfBytes += 1;
		max = max * base;
	}
	place = max / base;

	var buffer = new Buffer(numberOfBytes);
	for(var i = 0; i < numberOfBytes; i++) {
		var thisByte = 0;
		
		if(place <= 254) {
			thisByte = number;
		}
		else {
			thisByte = Math.floor(number/place);
			number = number - thisByte * place;
		}
		try {
			buffer.writeUInt8(thisByte + 1, i)
		}
		catch(err) {
			throw err
		}
		place = place / base;
	}

	return buffer;
};

var determineIndicatorByte = function(location, lastLocation) {
	var splitLocation = location.split(path.sep);
	var splitLastLocation = lastLocation.split(path.sep);

	// The commonBase is the part of the two locations that are the same.
	var commonBase = determineCommonBase(splitLocation, splitLastLocation);

	// This is what needs to be added.
	var stuffToAdd = _.rest(splitLastLocation, commonBase.length);

	if(location === lastLocation) {
		return {
			indicator: 0
		}
	}
	// Gotta add stuff to get back!
	else if(commonBase.join('/') === location) {
		return {
			indicator: 1,
			newStuff: stuffToAdd.join('/')
		}
	}
	else {
		// How many levels up to get to the common base?!?
		var levelsUp = splitLocation.length - commonBase.length

		return {
			indicator: 2,
			newStuff: stuffToAdd.join('/'),
			levelsUp: levelsUp
		}
	}
};

var determineCommonBase = function(one, two) {
	var commonBase = [];
	var stop = false;

	// TODO rewrite this...
	_.each(one, function(item, index) {
		if(!stop && two[index] === item) {
			commonBase.push(item);
		}
		else {
			stop = true;
		}
	});

	return commonBase
};

var openFile = function(path, callback) {
	fs.open(path, 'w', function(err, fd) {
		callback(err, fd);
	});
};

var startMetaData = function(fd, callback) {
	fs.write(fd, 'pop01', 'utf-8', function(err) {
			if(err) {
				callback(err);
				return;
			}
			var NullBytes = new Buffer(64);
			NullBytes.fill('\0');
			fs.write(
				fd, 
				NullBytes,
				0, 
				NullBytes.length, 
				function(err) {
					callback(err, 5 + 64);
				});
		});
};

// Writes a null byte at the current location.
var writeNullByte = function(fd) {
	return function(byteCount, callback) {
		if(!callback) {
			callback = byteCount;
			byteCount = 0;
		}

		fs.write(fd, '\0', 'utf-8', function(err) {
			callback(err, byteCount + 1);
		});
	}
};

// Writes a string at the current location.
var writeString = function(fd, string) {
	return function(byteCount, callback) {
		if(!callback) {
			callback = byteCount;
			byteCount = 0;
		}
		
		fs.write(fd, string, 'utf-8', function(err) {
			callback(err, byteCount + string.length);
		});
	}
};

var writeBackwardsInt = function(fd, number) {
	return function(byteCount, callback) {
		if(!callback) {
			callback = byteCount;
			byteCount = 0;
		}
		
		var buffer = getBufferForNumber(number);
		fs.write(fd, buffer, 0, buffer.length, function(err) {
			callback(err, byteCount + buffer.length);
		});
	}
};

var writeTailEnd = function(infoObject, callback) {
	var fd = infoObject.fd;
	var lastLocation = infoObject.lastLocation;
	var largestFileSize = infoObject.largestFileSize;
	var totalContainerLength = infoObject.totalContainerLength;
	async.waterfall([
				writeNullByte(fd),
				writeString(fd, lastLocation),
				writeNullByte(fd),
				writeBackwardsInt(fd, lastLocation.length),
				writeNullByte(fd),
				writeBackwardsInt(fd, largestFileSize),
				writeNullByte(fd),
				writeBackwardsInt(fd, totalContainerLength)
			], 
			function(err, byteCount) {
				callback(err, byteCount);
			});
};

module.exports = Bubble;