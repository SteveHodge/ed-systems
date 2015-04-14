var fs = require('fs');
var http = require('http');
var _ = require('underscore');
var vm = require('vm');
var readline = require('readline');

// fake jquery's .each function for trilateration.js:
$ = {
	each: function(coll, callback) {
		_.each(coll, function(value, key) {
			return callback.call(value, key, value);
		});
	}
};

var include = function(path) {
	var code = fs.readFileSync(path);
	vm.runInThisContext(code, path);
}.bind(this);

include('./trilateration.js');

var systemsResp;	// original response
var systems;	// systems array (= systemsResp.systems)
var systemsMap;	// map of nameKey -> system
var distancesResp;	// orginal response
var distances;	// distances array (= distancesResp.distances)
var distancesMap;	// map of nameKey -> distance

var useCache = false;		// set useCache = true for debugging. doesn't contact the server, just uses tgc*-raw.json files
var timestamp = (new Date()).toISOString();
timestamp = timestamp.substr(0,10) + ' ' + timestamp.substr(11,8);
//timestamp = '2015-02-03 00:00:00';	// force timestamp so diffs are cleaner
var updater = 'RW Correction';
var doCoords = true;

var distancesDataset = {
	name: 'Distances',
	cache: 'tgcdistances-raw.json',
	api: 'GetDistances',
	root: 'distances',
	usecache: true	// if true then will use the data in the cache file and only fetch newer data from the server (provided useCache is false)
};

var systemsDataset = {
	name: 'Systems',
	cache: 'tgcsystems-raw.json',
	api: 'GetSystems',
	root: 'systems',
	usecache: false	// if true then will use the data in the cache file and only fetch newer data from the server (provided useCache is false)
};


fetchData(systemsDataset, function(data) {
	systemsResp = data;
	systemsMap = {};
	var toRemove = [];
	_.each(data.systems, function(s, i) {
		var key = nameKey(s.name);
		if (key in systemsMap) {
			console.log('Duplicate system: '+s.name+' added by '+s.commandercreate+' '+s.createdate);
			toRemove.push(i);
		} else {
			systemsMap[key] = s;
		}
	});
	// remove duplicate systems
	for (var i = toRemove.length-1; i >= 0; i--) {
		console.log('Deleting duplicate '+data.systems[toRemove[i]].name);
		data.systems.splice(toRemove[i], 1);
	}

	systems = data.systems;
	if (!useCache) writeFile('Systems', 'tgcsystems-raw.json', systemsResp);
	if (distances) processData();
});

fetchData(distancesDataset, function(data) {
	distancesResp = data;
	distancesMap = {};
	_.each(data.distances, function(s) {
		var key = nameKey(s.name);
		if (key in distancesMap) {
			console.log("Warning: duplicate system detected in distance data: '"+s.name+"', '"+distancesMap[key].name+"' existing");
			// TODO should merge the distances entries and update distances with the original id
		} else {
			distancesMap[key] = s;
		}
	});
	distances = data.distances;
	if (!useCache) writeFile('Distances', 'tgcdistances-raw.json', distancesResp);
	if (systems) processData();
});

// finds a distance in distancesMap. returns {from, to, index}:
// from = distancesMap entry for system called name1. null if no system called name1 is found
// to = from.refs entry for system called name2. null if no system called name2 exists in from.refs
// index = index into from.refs of entry. -1 if no system called name2 exists in from.refs
function findDistance(name1, name2, dist) {
	var ret = {from: null, to: null, index: -1};
	name1 = nameKey(name1);
	name2 = nameKey(name2);
	ret.from = distancesMap[name1];
	if (ret.from) {
		_.each(ret.from.refs, function(t, i) {
			if (nameKey(t.name) === name2 && t.dist === dist) {
				ret.to = t;
				ret.index = i;
			}
		});
	}
	return ret;
}

function processData() {
	removeDupeDists();

	applyFixups();

	removeDupeDists();	// TODO shouldn't need to run twice but applyFixups doesn't check for duplicate distances when changing the distance (it probably should)

	if (doCoords) checkCoords();
	
	checkNames();

	var coordMap = {};
	var duplicated = {};
	_.each(systems, function(s) {
		if (s.coord[0] != null) {
			var key = s.coord[0]+','+s.coord[1]+','+s.coord[2];
			if (key in coordMap) {
				duplicated[key] = true;
			} else {
				coordMap[key] = [];
			}
			coordMap[key].push(s);
		}
	});

	console.log('\n----- Duplicate coordinates -----');
	_.each(_.keys(duplicated), function(k) {
		console.log(_.reduce(coordMap[k], function(memo, s) {
			return memo + (memo ? ', ' : '') + "'" + s.name + "'";
		}, ''));
	});
	console.log('----------\n');

	writeFile('Systems', 'tgcsystems.json', systemsResp);
	writeFile('Distances', 'tgcdistances.json', distancesResp);
}

function removeDupeDists() {
	var count = 0;
	_.each(distances, function(s) {
		var keys = {};
		var toDel = [];
		_.each(s.refs, function(d, i) {
			var k = nameKey(d.name)+','+d.dist;
			if (keys[k]) {
				toDel.push(i);
			} else {
				keys[k] = true;
			}
		});

		// assumes toDel is already sorted, which it should be
		_.each(toDel.reverse(), function(i) {
			var d = s.refs.splice(i, 1);
			//console.log(s.name+': deleted '+d[0].name+' at '+i);
			count++;
		});
	});
	console.log('Deleted '+count+' duplicate distances');
}

function renameSystem(system, corrected) {
	// rename system and any distances
	system.name = corrected;
	var key = nameKey(system.name);
	var dist = distancesMap[key];
	if (dist) {
		dist.name = corrected;
	}
	_.each(distances, function(from) {
		_.each(from.refs, function(to) {
			if (nameKey(to.name) === key) {
				to.name = corrected;
			}
		});
	});
}

function checkNames() {
	var data;

	try {
		data = fs.readFileSync('validsectors.json', {encoding:'utf8'});
	} catch (err) {
		console.log('Error reading "validsectors.json": '+err);
		return;
	}

	var validSectors = JSON.parse(data);

	var validPrefix = [
		"Feige", "Gliese", "Groombridge", "Kim", "Kruger", "Lacaille", "Lalande", "Lowne", "Luhman",
		"Luyten", "Melotte 20", "Ross", "Smethells", "Stein", "StHA", "StKM", "Struve", "Wo", "Wolf"
	];
	var validNames = [
		"SADR", "2MASS J07464256+2000321 A", "2MASS J16543745-4147071", "2MASS J19444913+2401342",
		"2MASS J21371591+5726591", "BD+40 2905A", "BD+48 1845B", "BD-19 3629A", "CSI-21-22270",
		"G146-60", "LDS 1503A", "MJD95 J194518.34+240059.7", "MJD95 J194547.54+240600.4", "NN 3086 A",
		"SDSS J1416+1348", "VESPER-M4", "WISE J000517", "WISE J004945", "WISE J0254+0223"
	];

	var names = {};
	var recapitalised = 0;
	var matches;
	var fixedCatalogs = {};
	console.log('\n----- Suspect Names -----');
	_.each(systems, function(s) {
		if (s.name.match(/\s([a-z][a-z]-[a-z])\s/i)) {
			// a generated name
			if (matches = s.name.match(/^(.*)\s+([a-z][a-z]-[a-z])\s+([a-g]\d+)(-\d+)?$/i)) {
				var sectMatch = matches[1].toLowerCase();
				var sector = _.find(validSectors, function(sector) {return sector.toLowerCase() === sectMatch;});
				if (!sector) {
					if (sectMatch in names) {
						names[sectMatch]++;
					} else {
						names[sectMatch] = 1;
					}
				} else {
					var corrected = sector + ' ' + matches[2].toUpperCase() + ' ' + matches[3].toLowerCase() + (matches[4] ? matches[4] : '');
					if (corrected !== s.name) {
						renameSystem(s, corrected);
						recapitalised++;
					}
				}
			} else {
				// something else (probably a typo in sector or the last element)
				console.log("Regex Failed: '"+s.name+"'");
			}
		} else if (matches = s.name.match(/^(.*)\s+(\d+([+-]\d+)*)$/i)) {
			// ends in a number - probably a catalog name
			var found = false;
			
			_.each(validPrefix, function(prefix) {
				if (matches[1].toLowerCase() === prefix.toLowerCase()) {
					if (matches[1] !== prefix) {
						renameSystem(s, prefix+' '+matches[2]);
						recapitalised++;
					}
					found = true;
				}
			});
			if (!found && matches[1] !== matches[1].toUpperCase()) {
				renameSystem(s, s.name.toUpperCase());
				recapitalised++;
				if (matches[1].toUpperCase() in fixedCatalogs) {
					fixedCatalogs[matches[1].toUpperCase()]++;
				} else {
					fixedCatalogs[matches[1].toUpperCase()] = 1;
				}
			}
			
		} else {
			// if it's all caps or all lowercase it's probably wrong
			if (!s.name.match(/[A-Z]/)) {
				if (validNames.indexOf(s.name) === -1) {
					console.log('No caps: '+s.name);
				}
			} else if (!s.name.match(/[a-z]/)){
				if (validNames.indexOf(s.name) === -1) {
					console.log('All caps: '+s.name);
				}
			}
		}
	});

	console.log('');
	_.each(Object.keys(fixedCatalogs).sort(), function(s) {
		console.log('Fixed Catalog: "'+s+'", '+fixedCatalogs[s]+' instances');
	});
	console.log('\n----- Bad Sector Names -----');
	_.each(Object.keys(names).sort(), function(s) {
		console.log('Bad Sector: "'+s+'", '+names[s]+' instances');
	});
	console.log('\n----------');
	console.log('Corrected capitalisation for '+recapitalised+' systems');
}

// TODO refactor "update system"
function applyFixups() {
	// apply fixups (from tgcfixups.json)
	var fixes;
	try {
		fixes = JSON.parse(fs.readFileSync('tgcfixups.json', {encoding:'utf8'}));
	} catch (err) {
		console.log('Error reading tgcfixups.json: '+err);
	}

	var applied = 0;
	var deleted = 0;	// number of systems deleted (explicitly or due to merges)
	_.each(fixes, function(fix) {
		if (fix.action === 'update distance' && 'changes' in fix) {
			var d = findDistance(fix.system1, fix.system2, fix.dist);
			if (d.from == null) {
				console.log("Couldn't find system "+fix.system1);
			} else if (d.to == null) {
				console.log("Couldn't find distance to "+fix.system2+' from '+d.from.name);
			} else {
				_.each(fix.changes, function(newVal, key) {
					if (key === 'system1') {
						// find the new system in the distances data
						var newd = findDistance(newVal, fix.system2, fix.dist);
						if (!newd.from) {
							// no distances entry for new system: make one
							var newsys = systemsMap[nameKey(newVal)];
							if (newsys) {
								newd.from = _.clone(newsys);
								delete newd.from.cr;
								newd.from.refs = [];
								distances.push(newd.from);
								distancesMap[nameKey(newd.from.name)] = newd.from;
							}
						}
						if (newd.from) {
							d.from.refs.splice(d.index, 1);	// should be returning an array containing d.only to
							if (!newd.to) {
								newd.from.refs.push(d.to);
							} else {
								//console.log('Duplicate distance from '+newd.from.name+' to '+d.to.name+' ('+fix.dist+' Ly) - ignored');
							}
						} else {
							console.log("  Couldn't find new system "+newVal);
						}

					} else if (key === 'system2' || key === 'name') {
						// update id and coordinates
						var newsys = systemsMap[nameKey(newVal)];
						if (newsys) {
							d.to.name = newsys.name;
							d.to.id = newsys.id;
							d.to.coord[0] = newsys.coord[0];
							d.to.coord[1] = newsys.coord[1];
							d.to.coord[2] = newsys.coord[2];
						} else {
							console.log("  Couldn't find new system "+newVal);
						}

					} else {
						d.to[key] = newVal;
					}
				});
	
				d.to.commanderupdate = updater;
				d.to.updatedate = timestamp;
				applied++;
			}

		} else if (fix.action === 'delete distance') {
			var d = findDistance(fix.system1, fix.system2, fix.dist);
			if (d.from == null) {
				console.log("Couldn't find system "+fix.system1);
			} else if (d.to == null) {
				console.log("Couldn't find distance to "+fix.system2+' from '+d.from.name);
			} else {
				d.from.refs.splice(d.index, 1);	// should be returning an array containing dist
			}

		} else if (fix.action === 'update system') {
			var key = nameKey(fix.name);
			var s = systemsMap[key];
			if (!s) {
				console.log("Couldn't find system "+fix.name);
			} else {
				_.each(fix.changes, function(newVal, prop) {
					if (prop === 'name') {
						var newKey = nameKey(newVal);
						var existing = systemsMap[newKey];
						var dist = distancesMap[key];
						if (existing && newKey !== key) {
							// merge into existing system
							//console.log(s.name+' will be merged and deleted');
							if (dist) {
								// sort out distances
								var target = distancesMap[newKey];
								if (target) {
									target.name = newVal;	// update name incase the existing system name has different capitalisation from the desired name
									// move existing distances to target system, checking for duplicates
									_.each(dist.refs, function(ref) {
										if (!_.find(target.refs, function(r) {
											return nameKey(r.name) === nameKey(ref.name) && r.dist === ref.dist;
										})) {
											target.refs.push(ref);
										}
									});
									// delete old distances block and map entry
									delete distancesMap[key];
									distances.splice(distances.indexOf(dist),1);
								} else {
									// rename our distances entry to the new system name and update map
									distancesMap[newKey] = dist;
									delete distancesMap[key];
									dist.name = newVal;
									dist.commanderupdate = updater;
									dist.updatedate = timestamp;
									dist.id = existing.id;
								}
							}
							// remove our entry from the systems list and map
							systems.splice(systems.indexOf(s),1);
							deleted++;
							delete systemsMap[key];
							existing.name = newVal;	// update name incase the existing system name has different capitalisation from the desired name

						} else {
							// no existing difference, just apply the name change
							if (dist) {
								// update distances block
								dist.name = newVal;
								dist.commanderupdate = updater;
								dist.updatedate = timestamp;
							}
							if (key !== newKey) {
								// need to update systemsMap and distancesMap
								delete systemsMap[key];
								systemsMap[newKey] = s;
								if (dist) {
									distancesMap[newKey] = dist;
									delete distancesMap[key];
								}
							}
							// update system block (commanderupdate and updatedate done below)
							s.name = newVal;
						}

						// update any distance refs:
						_.each(distances, function(from) {
							_.each(from.refs, function(to) {
								if (nameKey(to.name) === key) {
									to.name = newVal;
									to.commanderupdate = updater;
									to.updatedate = timestamp;
									if (existing) to.id = existing.id;
								}
							});
						});

					} else {
						s[prop] = newVal;
					}
				});
	
				s.commanderupdate = updater;
				s.updatedate = timestamp;
				applied++;
			}

		} else if (fix.action === 'delete system') {
			var key = nameKey(fix.name);
			var s = systemsMap[key];
			if (!s) {
				console.log("Couldn't find system "+fix.name);
			} else {
				// delete any distance block
				var dist = distancesMap[key];
				if (dist) {
					distances.splice(distances.indexOf(dist),1);
					delete distancesMap[key];
				}
				// find and delete any reference distances
				_.each(distances, function(from) {
					if (from.refs) {
						for (var i = from.refs.length-1; i >= 0; i--) {
							if (nameKey(from.refs[i].name) === key) {
								from.refs.splice(i, 1);
							}
						}
					}
				});
				// delete the system block
				systems.splice(systems.indexOf(s),1);
				deleted++;
				delete systemsMap[key];
			}

		} else {
			console.log('Unknown type of fix requested ('+fix.action+') or no changes requested');
		}
	});
	console.log('Applied '+applied+' fixes');
	console.log('Deleted '+deleted+' systems (explicitly/merged)');
	console.log('----------\n');
}

function checkCoords() {
	// get count by cr for comparison:
	var cr = [0,0,0,0,0,0,0];
	_.each(systems, function(s) {
		cr[s.cr ? s.cr : 0]++;
	});
	_.each(cr, function(count, cr) {
		if (count > 0) {
			console.log('CR '+cr+': '+count+' systems');
		}
	});
	
	// check coordinates:
	// 1. build map of accepted systems starting with FD supplied systems from systems data
	var located = {};
	_.each(systems, function(s, i) {
		if (s.commandercreate === 'FD' && s.cr >= 5) {
			located[nameKey(s.name)] = {
				name: s.name,
				x: s.coord[0],
				y: s.coord[1],
				z: s.coord[2]
			};
		}
	});
	console.log('Reference systems: '+Object.keys(located).length);

	// 2. build list of calculated systems (in distances data) with all distances
	var toLocateMap = {};
	_.each(distances, function(s1) {
		_.each(s1.refs, function(s2) {
			var s1key = nameKey(s1.name);
			var s2key = nameKey(s2.name);
						
			// distance from s1 to s2, add to the two systems unless they are reference systems
			if (!(s1key in located)) {
				if (!(s1key in toLocateMap)) {
					toLocateMap[s1key] = {
						name: s1.name,
						distances: []
					};
				}
				toLocateMap[s1key].distances.push({system: s2key, distance: s2.dist});
			}
			if (!(s2key in located)) {
				if (!(s2key in toLocateMap)) {
					toLocateMap[s2key] = {
						name: s2.name,
						distances: []
					};
				}
				toLocateMap[s2key].distances.push({system: s1key, distance: s2.dist});
			}
		});
	});
	var toLocate = _.values(toLocateMap);

	var found;
	var totalFound = 0;
	do {
		found = 0;
		console.log('To locate: '+(toLocate.length-totalFound));
		var done = 0;
		_.each(toLocate, function(s) {
			var sysKey = nameKey(s.name);
			done++;
			if (!('distances' in s)) return;
			if (sysKey === 'sagittarius a*') return;	// TODO temporarily skipping Sag A* as it takes a long time

			readline.clearLine(process.stdout);
			readline.cursorTo(process.stdout, 0);
			process.stdout.write((done-1) + ' done, locating '+s.name);

			// 3. calculate coordinates for all system in list from 2 using distances to confirmed systems in 1.
			var trilat = new Trilateration();

			// set coordinates if not already set
			var newCoords = false;
			for (var i = 0; i < s.distances.length; i++) {
				var key = nameKey(s.distances[i].system);
				// if the target system is located and we either don't have the location recorded or the location has changed...
				if (key in located && (!('x' in s.distances[i]) || !identicalVectors(s.distances[i], located[key]))) {
					setVector(s.distances[i], located[key]);					// add coordinates for new/changed distance
					if (sysKey in located) {
						// already located - only retrilaterate if the new distance does not match
						var result = checkDist(s, s.distances[i], s.distances[i].distance);
						if (result.error !== 0) {
							//if (!newCoords) console.log('\nFound bad distance for '+s.name+' to '+s.distances[i].system+', rechecking location');
							newCoords = true;
						}
					} else {
						// no location, we have new coords
						newCoords = true;
					}
				}
				if ('x' in s.distances[i] && !(key in located)) {
					// remove coords as target system no longer has a location
					console.log('\nTarget system for '+s.name+' to '+s.distances[i].system+' no longer has coords, rechecking location');
					delete s.distances[i].x;
					delete s.distances[i].y;
					delete s.distances[i].z;
					newCoords = true;	// need to relocate
				}
			}

			if (!newCoords) {
				return;		// can skip trying to trilaterate in this pass if we didn't set new coordinates
			}
			
			for (var i = 0; i < s.distances.length; i++) {
				var key = nameKey(s.distances[i].system);
				if ('x' in s.distances[i]) {
					trilat.addDistance(s.distances[i]);
					// if we're over 10 distances and we've got a good result (all distances accurate or best candidate 2 distances better
					// than next) stop trailatering to prevent poor performance:
					if (isGoodTrilat(trilat) && i > 9) break;
				}
			}

			if (isGoodTrilat(trilat, s.name)) {
				// 4. add newly located systems to map from 1.
				found++;
				setVector(s, trilat.best[0]);
				located[sysKey] = s;
			} else if (sysKey in located) {
				// location is no longer good, remove it from located
				delete located[sysKey];
				console.log('\n'+s.name+' no longer has good trilateration');
			}
		});
		readline.clearLine(process.stdout);
		readline.cursorTo(process.stdout, 0);
		console.log('-- pass complete, found '+found+' coordinates');
		totalFound += found;
	} while (found > 0);		// 5. repeat 3-4 until no new systems can be located

	// 6. check that there no systems from systems data missing or missing coordinates
	var toLocateMap = {};
	_.each(toLocate, function(s) {
		toLocateMap[nameKey(s.name)] = s;
	});
	var extraLocated= 0;
	var updated = 0;
	_.each(systems, function(s) {
		var key = nameKey(s.name);
		if (key in located) {
			if (s.coord[0] == null || s.coord[0] !== located[key].x && s.coord[1] !== located[key].y || s.coord[2] !== located[key].z) {
				if (s.coord[0] == null) {
					//console.log(s.name+': coords missing in TGC, calculated '+vectorToString(located[key]));
					extraLocated++;
				} else {
					//console.log(s.name+': coords different: TGC ('+s.coord[0]+', '+s.coord[1]+', '+s.coord[2]+'), calculated '+vectorToString(located[key]));
				}
				updated++;
				s.coord[0] = located[key].x;
				s.coord[1] = located[key].y;
				s.coord[2] = located[key].z;
				s.tgcunlocated = true;
				if (s.cr < 2) s.cr = 2;
				// need to update any coordinates in distances too:
				_.each(distances, function(d) {
					if (nameKey(s.name) === nameKey(d.name)) {
						d.coord[0] = located[key].x;
						d.coord[1] = located[key].y;
						d.coord[2] = located[key].z;
					} else {
						_.each(d.refs, function(r) {
							if (nameKey(s.name) === nameKey(r.name)) {
								r.coord[0] = located[key].x;
								r.coord[1] = located[key].y;
								r.coord[2] = located[key].z;
							}		
						});
					}
				});
			}

			if ('distances' in located[key]) {
				// check all distances
				var good = 0;
				var bad = 0;
				var unknown = 0;
				var onedp = 0;
				var output = [];
				for (var i = 0; i < located[key].distances.length; i++) {
					// set coordinates if they haven't already been set
					var otherkey = nameKey(located[key].distances[i].system);
					if (!('x' in located[key].distances[i]) && (otherkey in located)) {
						setVector(located[key].distances[i], located[otherkey]);
					}
					if ('x' in located[key].distances[i]) {
						var result = checkDist(located[key], located[key].distances[i], located[key].distances[i].distance);
						if (result.error === 0) {
							good++;
						} else {
							var d = located[key].distances[i].distance;
							var calc = eddist(located[key], located[key].distances[i], result.dp);
							if (d === Math.round(calc*10)/10) {
								// seems to be a correct 1 dp distances (probably from the nav panel)
								onedp++;
							} else {
								output.push('  Bad distance '+located[key].name+' to '+located[key].distances[i].system+': '+d+' should be '+calc);
								bad++;
							}
						}
					} else {
						unknown++;
					}
				}

				if (bad > 2) {
					var txt = [];
					if (bad > 0) txt.push(bad+' bad distances');
					if (unknown > 0) txt.push(unknown+' unknown distances');
					if (onedp > 0) txt.push(onedp+' matching one dp distances');
					if (good > 0) txt.push(good+' good distances');
					console.log(s.name+': '+txt.join(', ')+':');
					_.each(output, function(t) {console.log(t);} );
				}
			}

		} else if (key in toLocateMap) {
			if (s.coord[0] != null) {
				console.log(s.name+': TGC has coords ('+s.coord[0]+', '+s.coord[1]+', '+s.coord[2]+"), couldn't trilaterate");
				for (var i = 0; i < toLocateMap[key].distances.length; i++) {
					console.log('  '+toLocateMap[key].distances[i].system+': '+toLocateMap[key].distances[i].distance);
				}
			}
		} else {
			//console.log(s.name+': system not known from distances');
		}
	});

	console.log('\nLocated '+extraLocated+" systems that don't have coordinates in TGC");
	var cr = [0,0,0,0,0,0,0];
	var located = 0;
	_.each(systems, function(s) {
		cr[s.cr ? s.cr : 0]++;
		if (s.coord && s.coord[0] != null) located++;
	});
	_.each(cr, function(count, cr) {
		if (count > 0) {
			console.log('CR '+cr+': '+count+' systems');
		}
	});
	console.log('Total located systems: '+located);
}

function isGoodTrilat(trilat, debug) {
	if (!('best' in trilat) || trilat.best.length !== 1) return false;	// no result or multiple equally good results
	if (false && debug && (debug.toLowerCase() === 'mel 22 sector jo-o b7-0'|| debug === 'HIP 14769')) {
		console.log('------------- '+debug+' --------------');
		console.log('  distances: '+trilat.distances.length+', best: '+trilat.bestCount+', next: '+trilat.nextBest);
		console.log('  best: '+vectorToString(trilat.best[0]));
		for (var i = 0; i < trilat.distances.length; i++) {
			console.log('  '+trilat.distances[i].system+' '+vectorToString(trilat.distances[i])+': '+trilat.distances[i].distance
				+' (calculated: '+eddist(trilat.best[0], trilat.distances[i])+')');
		}
	}
	if (trilat.distances.length >= 5 && trilat.bestCount - trilat.nextBest >= 2) return true;	// 5 distances with margin of at least 2 for best candidate
	if (trilat.distances.length >= 4 && trilat.bestCount === trilat.distances.length) return true;	// 4 or more unanimous distances (we test all distances if there are less than 11 so this should be safe)
	return false;
}

function nameKey(n) {
	return n.toLowerCase().trim();
}

function fetchData(dataset, callback) {
	var updated = '2014-09-09 12:13:14Z';
	if (useCache || dataset.usecache) {
		fs.readFile(dataset.cache, {encoding:'utf8'}, function(err, d) {
			var data = {};
			if (err) {
				console.log(dataset.name+' cache: '+err);
			} else {
				data = JSON.parse(d);
				var fetchDate = new Date(data.date.substr(0,10)+'T'+data.date.substr(11,8)+'Z');
				fetchDate.setTime(fetchDate.getTime()-1000*60*60*24);	// subtract 1 day
				updated = fetchDate.toISOString();
				updated = updated.substr(0,10)+' '+updated.substr(11,8)+'Z';
				console.log(dataset.name+' cache: ok');
			}
			if (!useCache) {
				// update with newer data from server
				fetchTGCData(dataset, updated, function(d) {
					// merge d into data
					data.ver = d.ver;
					data.date = d.date;
					data.status = d.status;
					_.each(d[dataset.root], function(el) {
						// try to find the element in data
						var existing = _.find(data[dataset.root], function(e) {return e.name === el.name && e.id === el.id;});
						if (existing) {
							// replace the existing element's details:
							existing.coord = el.coord;
							existing.commandercreate = el.commandercreate;
							existing.createdate = el.createdate;
							existing.commanderupdate = el.commanderupdate;
							existing.updatedate = el.updatedate;
							if ('cr' in el) existing.cr = el.cr;
							if ('refs' in el) {
								// merge the distance list
								_.each(el.refs, function(newdist) {
									var olddist = _.find(existing.refs, function(dist) {return dist.name === newdist.name && dist.id === newdist.id && dist.dist === newdist.dist;});
									if (olddist) {
										// replace the distance details
										olddist.coord = newdist.coord;
										olddist.cr = newdist.cr;
										olddist.commandercreate = newdist.commandercreate;
										olddist.createdate = newdist.createdate;
										olddist.commanderupdate = newdist.commanderupdate;
										olddist.updatedate = newdist.updatedate;								
									} else {
										// add the new distance
										existing.refs.push(newdist);
									}
								});
							}
						} else {
							// append new element to data
							data[dataset.root].push(el);
						}
					});
					data[dataset.root].sort(function(a,b) {return a.name.toLowerCase().localeCompare(b.name.toLowerCase());});
					callback(data);
				});
			} else {
				callback(data);
			}
		});
	} else {
		fetchTGCData(dataset, updated, callback);
	}
}

function fetchTGCData(dataset, since, callback) {
	console.log(dataset.name+': Fetching data since '+since+' from server');

	var query = {
		ver:2, 
		outputmode:2, 
		filter:{
			date: since,
			cr: 0
		}
	};
	
	var reqOptions = {
		hostname: 'edstarcoordinator.com',
		path: '/api.asmx/'+dataset.api,
		method: 'POST'
	};
	
	var req = http.request(reqOptions, function(res) {
		res.setEncoding('utf8');
		if (res.statusCode !== 200) {
			console.log(dataset.name+': Response status: ' + res.statusCode);
			console.log(dataset.name+': Headers: ' + JSON.stringify(res.headers), null, 2);
			res.on('data', function(chunk) {
				console.log(dataset.name+': '+chunk);
			});
		} else {
			var body = '';
			res.on('data', function(chunk) {
				body += chunk;
			});
			res.on('end', function() {
				fs.writeFile('Debug'+dataset.name+'.txt', body, function(err) {
					if (err) {
						console.log(dataset.name+': Error writing debug file: '+err);
					}
				});
				var data = JSON.parse(body).d;
				callback(data);
			});
		}
	});
	
	req.on('error', function(e) {
		console.log(dataset.name+': Problem with request: ' + e.message);
	});
	
	req.setHeader('content-type','application/json; charset=utf-8');
	
	// write data to request body
	req.write(JSON.stringify({data: query})+'\n');
	req.end();
	console.log(dataset.name+': fetching...');
}

function writeFile(name, filename, data) {
	var text = JSON.stringify(data, null, 2).replace(/\n/g,'\r\n');
	try {
		fs.writeFileSync(filename, text);
		console.log(name+': Wrote '+data[name.toLowerCase()].length+' systems to '+filename);
	} catch (err) {
		console.log(name+': Error writing '+filename+': '+err);
	}
}
