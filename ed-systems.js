/* input format of systems from edsm:
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

/* output format of systems produced:
	name - system name
	x, y, z - coordinates if known
	fd_supplied - true if the system was supplied by FD
	contributor - name of first person to submit the system
	contributed - datetime system was first submitted
	*distances - array of distances to other systems
	*tgc - tgc specific properties (x, y, z)
	*edsm - edsm specific properties (x, y, z)
	*contributors - array of contributors (name, date)

	TODO (*) not current implemented
*/

function EDSMConnector() {
	var systemsLastFetched = null;		// time of last date fetch (in milliseconds since epoch)
	var distsLastFetched = null;
	var _this = this;

	// load existing systems
	this.loadSystemsCache = function(callback) {
		$.getJSON('edsmsystems.json', function(data) {
			_this.systemsLastFetched = data.date;
			mapSystems(data.systems);
			logAppend('Loaded edsmsystems.json: data up to '+new Date(data.date)+'. Total number of systems: '+Object.keys(systemsMap).length+'\n');
		}).fail(function(xhr, txt, err) {
			logAppend('Failed to read from edsmsystems.json:\n');
			logAppend(err.message+'\n');
		}).always(function() {
			callback();
		});
	};

	// load distances array from cache file. format:
	//{
	//  "date": 1441801293000,
	//  "distances": [
	//    {
	//      "sys1": "* tet02 Orionis C",
	//      "sys2": "2MASS J05351294-0528498",
	//      "dist": 16.74,
	//      "contributors": [
	//        {
	//          "cmdrname": "Red_13",
	//          "date": "2015-08-28 10:24:58"
	//        }
	//      ]
	//    },
	// note assumes the date in the file is correct
	this.loadDistancesCache = function(callback) {
		$.getJSON('edsmdistances.json', function(data) {
			_this.distsLastFetched = data.date;

			$.each(data.distances, function() {
				var sub = analyseSubmitted(this.contributors);
	
				var s1 = getOrAddSystem(this.sys1, sub);
				var s2 = getOrAddSystem(this.sys2, sub);
	
				var d1 = getOrAddDistance(s1.distances, s2.name, this.dist);
				var d2 = getOrAddDistance(s2.distances, s1.name, this.dist);
				
				// TODO merge and save all submissions
				
				d1.creator = sub.contributor;
				d2.creator = sub.contributor;
				if (sub.contributed) {
					d1.created = sub.contributed;
					d2.created = sub.contributed;
				}
			});

			logAppend('Loaded edsmdistances.json: data up to '+new Date(data.date)+'. Total number of distances: '+data.distances.length+'\n');
		}).fail(function(xhr, txt, err) {
			logAppend('Failed to read from edsmsystems.json:\n');
			logAppend(err.message+'\n');
		}).always(function() {
			callback();
		});
	};
	
	this.updateSystems = function(callback) {
		//logAppend('Fetching since '+new Date(_this.systemsLastFetched).toISOString()+'\n');
		var query = {
			//	startdatetime: '1970-01-01 00:00:00 +00:00',
			coords: 1,
			submitted: 1
			//,sysname: 'Ursae Majoris'
		};
		if (_this.systemsLastFetched) {
			var d = new Date(_this.systemsLastFetched).toISOString();
			query.startdatetime = d.substr(0,10)+' '+d.substr(11,8);
		}

//encodeURIComponent(JSON.stringify(query)

		$.ajax({
			type: 'GET',
			url: 'http://www.edsm.net/api-v1/systems',
			data: query,
			dataType: 'json',
			success: function(data, status, xhr) {
				//logAppend(JSON.stringify(data, null, 2));
				var d = importSystems(data);
				if (d && (!_this.systemsLastFetched || _this.systemsLastFetched < d)) {
					_this.systemsLastFetched = d;
				}
				logAppend('Fetched '+data.length+' systems from EDSM up to '+new Date(_this.systemsLastFetched)+'. Total number of systems: '+Object.keys(systemsMap).length+'\n');
				callback();
			},
			error: function(xhr, status, error) {
				logAppend(error+'\n');
				console.log('Error from EDSM server: '+error);
				console.log('Status = '+status);
				console.log('XHR status = '+xhr.responseText);
				callback();
			}
		});
	};

	this.updateDistances = function(callback) {
		//logAppend('Fetching since '+new Date(_this.distsLastFetched).toISOString()+'\n');
		var query = {
			//	startdatetime: '1970-01-01 00:00:00 +00:00',
			submitted: 1
			//,sysname: 'Ursae Majoris'
		};
		if (_this.distsLastFetched) {
			var d = new Date(_this.distsLastFetched).toISOString();
			query.startdatetime = d.substr(0,10)+' '+d.substr(11,8);
		}

		$.ajax({
			type: 'GET',
			url: 'http://www.edsm.net/api-v1/distances',
			data: query,
			dataType: 'json',
			success: function(data, status, xhr) {
				//logAppend(JSON.stringify(data, null, 2));
				var d = importDistances(data);
				if (d && (!_this.distsLastFetched || _this.distsLastFetched < d)) {
					_this.distsLastFetched = d;
				}
				logAppend('Fetched '+data.length+' distances from EDSM up to '+new Date(_this.distsLastFetched)+'\n');
				callback();
			},
			error: function(xhr, status, error) {
				logAppend(error+'\n');
				console.log('Error from EDSM server: '+error);
				console.log('Status = '+status);
				console.log('XHR status = '+xhr.responseText);
				callback();
			}
		});
	};

	// rebuilds systemsMap from the list of systems (in internal format)
	function mapSystems(systems) {
		systemsMap = {};
		$.each(systems, function() {
			var key = nameKey(this.name);
			if (!(key in systemsMap)) {
				systemsMap[key] = this;
			} else {
				console.log('Duplicate system for key '+key);
			}
		});
	};
	
	// imports systems in EDSC format
	function importSystems(systems) {
		var latest = null;
		$.each(systems, function() {
			var sys = {
				name: this.name,
				cr: 1
			}
			
			if (this.coords && this.coords.x != null) {
				sys.x = this.coords.x,
				sys.y = this.coords.y,
				sys.z = this.coords.z,
				sys.cr = 2;
			}
	
			// check if the system date is more recent than 'latest'
			if (this.date) {
				var d = getDate(this.date).getTime();
				if (latest == null || latest < d) latest = d;
			}
	
			// find oldest contributor and date
			var sub = analyseSubmitted(this.submitted);
			if (sub.contributed) sys.contributed = sub.contributed;
			if (sub.contributor) {
				sys.contributor = sub.contributor;
				if (sub.contributor === 'FD') sys.cr = 5;
			} else {
				sys.contributor = '(unknown)';
			}
			if (sub.latest && sub.latest > latest) latest = sub.latest;

			sys.calculated = sys.contributor !== 'FD' || sys.cr < 5;

			if ('tgcunlocated' in this) {
				sys.tgcunlocated = this.tgcunlocated;
			} else {
				delete sys.tgcunlocated;
			}
	
			var key = nameKey(this.name);
			if (!(key in systemsMap)) {
				systemsMap[key] = sys;
			} else {
				// TODO merge into existing system
				systemsMap[key] = sys;
			}
		});
		return latest;
	};

	// adds array of distances in EDSM format and returns the latest supplied distance
	//   {
   //    "sys1": {
   //        "name": "Eta Carinae",
   //        "date": "2015-05-13 07:02:49"
   //    },
   //    "sys2": {
   //        "name": "Ghost of Jupiter Sector FL-X b1-0",
   //        "date": "2015-09-11 23:44:45"
   //    },
   //    "distance": 6691.73,
   //    "submitted_by": [
   //        {
   //            "cmdr": "Doudon",
   //            "cmdrname": "Doudon",
   //            "date": "2015-09-11 23:44:44"
   //        }
   //    ],
   //    "date": "2015-09-11 23:44:44"
   //}
	function importDistances(dists) {
		var latest = null;
		$.each(dists, function() {
			var sub = analyseSubmitted(this.submitted_by);
			if (sub.latest && sub.latest > latest) latest = sub.latest;

			var s1 = getOrAddSystem(this.sys1.name, sub);
			var s2 = getOrAddSystem(this.sys2.name, sub);

			var d1 = getOrAddDistance(s1.distances, s2.name, this.distance);
			var d2 = getOrAddDistance(s2.distances, s1.name, this.distance);
			
			// TODO merge and save all submissions
			
			d1.creator = sub.contributor;
			d2.creator = sub.contributor;
			if (sub.contributed) {
				d1.created = sub.contributed;
				d2.created = sub.contributed;
			}
		});
	};

	// add or return the distance found in dists to the specified system
	// dists - array to add distance to
	// to - name of system the distance is measured to
	// dist - distance in Ly
	function getOrAddDistance(dists, to, dist) {
		var d = null;
		var k = nameKey(to);
		$.each(dists, function() {
			if (nameKey(this.system) === k && this.distance === dist) {
				d = this;
				return false;
			}
		});
		if (!d) {
			d = {system: to, distance: dist};
			dists.push(d);
		}
		return d;
	};

	// intended for retrieving or creating systems when importing distances. always returns a system which always has a distances property
	function getOrAddSystem(name, sub) {
		var k = nameKey(name);
		var s;
		if (!(k in systemsMap)) {
			s = {
				name: name,
				cr: 1,
				calculated: true,
				distances: []
			};
			if (sub.contributed) s.contributed = sub.contributed;
			s.contributor = sub.contributor ? sub.contributor : '(unknown)';
			systemsMap[k] = s;
		} else {
			s = systemsMap[k];
			if (!('distances' in s)) s.distances = [];
		}
		return s;
	};

	// analyses a submitted_by array and returns an object with name and date string of the oldest submission and date millis of
	// the newest submission
	// input:
	// [
	//     {
	//         "date": "2015-05-12 15:29:33"
	//     },
	//     {
	//         "cmdrname": "FD",
	//         "date": "2015-04-27 07:19:24"
	//     }
	// ]
	// output:
	// {
	// 	contributor: "FD",
	// 	contributed: "2015-04-27 07:19:24",
	// 	latest: 1431444573000
	// }
	function analyseSubmitted(subs) {
		var out = {};
		var current;	// millis version of out.contributed

		// find oldest contributor and date
		$.each(subs, function(i, sub) {
			var newdate = getDate(sub.date).getTime();
			if (!out.latest || out.latest < newdate) {
				out.latest = newdate;
			}

			if (!out.contributed) {
				if (sub.cmdrname) out.contributor = sub.cmdrname;
				out.contributed = sub.date;
				current = getDate(sub.date).getTime();
			} else if (newdate < current) {
				out.contributed = sub.date;
				current = newdate;
				if (sub.cmdrname) {
					out.contributor = sub.cmdrname;
				} else {
					delete out.contributor;
				}
			}
		});

		return out;
	}
};


EDSMConnector.prototype.fetchSystems = function(callback) {
	var _this = this;
	this.loadSystemsCache(function() {
		_this.updateSystems(callback);
	});
}

EDSMConnector.prototype.fetchDistances = function(callback) {
	var _this = this;
	this.loadDistancesCache(function() {
		_this.updateDistances(callback);
	});
}

EDSMConnector.prototype.fetch = function(callback) {
	var _this = this;
	this.loadSystemsCache(function() {
		_this.updateSystems(function() {
			_this.loadDistancesCache(function() {
				_this.updateDistances(callback);
			});
		});
	});
}

EDSMConnector.prototype.update = function(callback) {
	var _this = this;
	this.updateSystems(function() {
		_this.updateDistances(callback);
	});
}

var EDSM = new EDSMConnector();

// converts string of format 'YYYY-MM-DD HH:MM:SS' to a Date. Assumes UTC.
function getDate(dateString) {
	return new Date(dateString.replace(' ','T') + 'Z');
}
