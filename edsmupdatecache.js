var fs = require('fs');
var http = require('http');
var _ = require('underscore');
var vm = require('vm');
var readline = require('readline');
var qs = require('querystring');

/* format of systems
    {
        "name": "Carmenta",
        "coords": {
            "x": -15.6875,
            "y": -40.5,
            "z": 39.375
        },
        "submitted": [
            {
                "date": "2015-05-12 15:29:33"
            },
            {
                "cmdrname": "FD",
                "date": "2015-04-27 07:19:24"
            }
        ]
    }
*/

// system properties:
// name - system name
// x, y, z - coordinates if known
// calculated - true if the system was not supplied by FD
// cr - TGC "confidence rating" (5+ = FD supplied, 2 = coordinates, 1 = unlocated)
// contributor - name of first person to submit the system
// contributed - datetime system was first submitted
// distances - array of distances to other systems
// tgcunlocated - true if TGC doesn't have a location for this system

var sysmap = {};
var distances = null;
var distMap = {};	// map of distKey(distance)->distance
var useCache = false;

var since = null;
if (useCache) {
	var data = loadSystems('edsmsystems.json');
	mapSystems(data.systems);
	since = data.date;
}
fetchSystems(since, function(d) {
	writeFile('Systems', 'edsmsystems.json', processSystems(d));
});

if (useCache) {
	var d1 = loadDists('edsmdistances.json');
	mergeDists(d1.distances);
	
	//var d2 = loadDists('edsmdistances-20150515.json');
	//mergeDists(d2.distances);
	
	since = d1.date;
	//if (since == null || (d2.date && since < d2.date)) since = d2.date;
}

fetchDists(since, function(d2) {
	mergeDists(d2.distances);
	if (since == null || (d2.date && since < d2.date)) since = d2.date;

	distances.sort(function(a,b) {
		var c = a.sys1.localeCompare(b.sys1);
		if (c != 0) return c;
		c = a.sys2.localeCompare(b.sys2);
		if (c != 0) return c;
		return a.dist - b.dist;
	});
	writeFile('Distances', 'edsmdistances.json', {'date': since, 'distances': distances});
});


function loadSystems(filename) {
	try {
		var data = fs.readFileSync(filename, {encoding:'utf8'});
		data = JSON.parse(data);
	} catch (err) {
		console.log('Error reading "'+filename+'": '+err);
		return;
	}

	console.log('Loaded '+data.systems.length+' systems from '+filename);
	return data;
}

function fetchSystems(since, callback) {
	var reqOptions = {
		hostname: 'www.edsm.net',
		path: '/api-v1/systems?'+qs.stringify({
		//	startdatetime: '1970-01-01 00:00:00 +00:00',
			coords: 1,
			submitted: 1
		//	sysname: 'SZ Ursae Majoris'
		}),
		method: 'GET'
	};

	if (since) {
		var d = new Date(since).toISOString();
		d = d.substr(0,10)+' '+d.substr(11,8);
		console.log('Fetching systems since '+d);
		reqOptions.path += '&' + qs.stringify({startdatetime: d});
		
		// temporarily we only fetch two days worth of data at a time
//		d = new Date(since+1000*60*60*48).toISOString();
//		d = d.substr(0,10)+' '+d.substr(11,8);
//		console.log('Fetching systems up to '+d);
//		reqOptions.path += '&' + qs.stringify({enddatetime: d});
	}

	var req = http.request(reqOptions, function(res) {
		res.setEncoding('utf8');
		if (res.statusCode !== 200) {
			console.log('EDSM: Response status: ' + res.statusCode);
			console.log('EDSM: Headers: ' + JSON.stringify(res.headers), null, 2);
			res.on('data', function(chunk) {
				console.log('Error: '+chunk);
			});
		} else {
			var body = '';
			res.on('data', function(chunk) {
				body += chunk;
			});
			res.on('end', function() {
				console.log('Received '+body.length+' bytes');
				callback(JSON.parse(body));
			});
		}
	});
	
	req.on('error', function(e) {
		console.log('Problem with request: ' + e.message);
	});
	
	//req.setHeader('content-type','application/json; charset=utf-8');
	
	// write data to request body
	//req.write(JSON.stringify({data: query})+'\n');
	req.end();
	console.log('fetching systems...');
}


function fetchDists(since, callback) {
	reqOptions = {
		hostname: 'www.edsm.net',
		path: '/api-v1/distances?submitted=1',
		method: 'GET'
	};

	if (since) {
		var d = new Date(since).toISOString();
		d = d.substr(0,10)+' '+d.substr(11,8);
		console.log('Fetching distances since '+d);
		reqOptions.path += '&' + qs.stringify({startdatetime: d});
		
		// temporarily we only fetch one days worth of data at a time
//		d = new Date(since+1000*60*60*24).toISOString();
//		d = d.substr(0,10)+' '+d.substr(11,8);
//		console.log('Fetching distances up to '+d);
//		reqOptions.path += '&' + qs.stringify({enddatetime: d});
	}

	req = http.request(reqOptions, function(res) {
		res.setEncoding('utf8');
		if (res.statusCode !== 200) {
			console.log('EDSM: Response status: ' + res.statusCode);
			console.log('EDSM: Headers: ' + JSON.stringify(res.headers), null, 2);
			res.on('data', function(chunk) {
				console.log('Error: '+chunk);
			});
		} else {
			var body = '';
			res.on('data', function(chunk) {
				body += chunk;
			});
			res.on('end', function() {
				console.log('Received '+body.length+' bytes');
				var data = JSON.parse(body);
				var dists = [];
				var latest = null;
	
				_.each(data, function(d) {
					var dist = {
						sys1: d.sys1.name,
						sys2: d.sys2.name,
						dist: d.distance
					}
	
					if (dist.sys1.localeCompare(dist.sys2) > 0) {
						// swap the names as sys1 should be before sys2
						dist.sys1 = d.sys2.name;
						dist.sys2 = d.sys1.name;
					}
	
					var lastSub = null;
					if (d.submitted_by) {
						// remove some unnecessary data
						_.each(d.submitted_by, function(s) {
							var sub = getDate(s.date);
							if (sub != null && (lastSub == null || sub > lastSub)) lastSub = sub;
							delete s.cmdr;
						});
						dist.contributors = d.submitted_by;
					}
					if (lastSub != null && (latest == null || lastSub > latest)) latest = lastSub;
					
					dists.push(dist);
				});
	
				console.log('Got '+dists.length+' distances, latest = '+new Date(latest));
				callback({'date': latest, 'distances': dists});
			});
		}
	});
	
	req.on('error', function(e) {
		console.log('Problem with request: ' + e.message);
	});
	
	//req.setHeader('content-type','application/json; charset=utf-8');
	
	// write data to request body
	//req.write(JSON.stringify({data: query})+'\n');
	req.end();
	console.log('fetching distances...');
}

function loadDists(filename) {
	try {
		var data = fs.readFileSync(filename, {encoding:'utf8'});
		data = JSON.parse(data);
	} catch (err) {
		console.log('Error reading "'+filename+'": '+err);
		return;
	}

	console.log('Loaded '+data.distances.length+' distances from '+filename);
	return data;
}

// merge the array of distances supplied with the distances array, maintaining distMap
function mergeDists(newDists) {
	if (distances == null) {
		distances = newDists;
		_.each(distances, function(d) {
			distMap[distKey(d)] = d;
		});		
	} else {
		// merge data.distances into distances
		_.each(newDists, function(d) {
			var key = distKey(d);
			var old = distMap[key];
			if (!old) {
				// new distance
				distances.push(d);
				distMap[key] = d;
			} else if (!old.contributors && d.contributors) {
				// old distance with no contributors: copy contributors over
				old.contributors = d.contributors;
			} else if (old.contributors && d.contributors) {
				// old distance with contributors: merge the contributors arrays
				_.each(d.contributors, function(c) {
					if (!_.find(old.contributors, function(oc) {return c.cmdrname === oc.cmdrname && c.date === oc.date;})) {
						old.contributors.push(c);
					}
				});
			}
		});
	}
}

function distKey(d) {
	return d.sys1.toLowerCase()+'\n'+d.sys2.toLowerCase()+'\n'+d.dist;
}

function writeFile(name, filename, data) {
	var text = JSON.stringify(data, null, 2).replace(/\n/g,'\r\n');
	try {
		fs.writeFileSync(filename, text);
		console.log(name+': Wrote '+data[name.toLowerCase()].length+' '+name.toLowerCase()+' to '+filename);
	} catch (err) {
		console.log(name+': Error writing '+filename+': '+err);
	}
}

function mapSystems(systems) {
	_.each(systems, function(s) {
		var key = s.name.trim().toLowerCase();
		sysmap[key] = s;
	});
}

function processSystems(data) {
	var latest = null;
	_.each(data, function(s) {
		var key = s.name.trim().toLowerCase();
		if (key in sysmap) {
			console.log('Duplicate system '+s.name);
		}
						
		var sys = {
			name: s.name,
			cr: 1
		}
		
		if (s.coords && s.coords.x != null) {
			sys.x = s.coords.x;
			sys.y = s.coords.y;
			sys.z = s.coords.z;
			sys.cr = 2;
		}
	
		// check if the system date is more recent than 'latest'
		if (this.date) {
			var d = getDate(s.date);
			if (latest == null || latest < d) latest = d;
		}
		
		// find oldest contributor and date
		_.each(s.submitted, function(sub) {
			if (sub.cmdrname && sub.cmdrname === 'FD') {
				sys.cr = 5;
				sys.contributor = 'FD';
				sys.contributed = sub.date;
			} else if (!sys.contributed) {
				if (sub.cmdrname) sys.contributor = sub.cmdrname;
				sys.contributed = sub.date;
			} else {
				var current = getDate(sys.contributed);
				var newdate = getDate(sub.date);
				if (newdate < current) {
					sys.contributed = sub.date;
					if (sub.cmdrname) {
						sys.contributor = sub.cmdrname;
					} else {
						delete sys.contributor;
					}
				}
			}
	
			// check if the submission date is more recent than 'latest'
			if (sub.date) {
				var d = getDate(sub.date);
				if (latest == null || latest < d) latest = d;
			}
	
		});
		if (!sys.contributor) sys.contributor = '(unknown)';
	
		sys.calculated = sys.contributor !== 'FD' || sys.cr < 5;
	
		sysmap[key] = sys;
	});
	console.log('Got '+Object.keys(sysmap).length+' systems, latest = '+new Date(latest));
	
	var systems = _.values(sysmap);
	systems.sort(function(a,b) {
		return a.name.localeCompare(b.name);
	});

	return {'date': latest, 'systems': systems};
}

// converts string of format 'YYYY-MM-DD HH:MM:SS' to a number representing millis since epoch . Assumes UTC.
function getDate(dateString) {
	if (!dateString) return null;
	return new Date(dateString.replace(' ','T') + 'Z').getTime();
}