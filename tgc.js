// TODO refactor into class

var systemsMap;		// reference system data
var lastFetch = '2014-09-09 12:13:14Z';		// last system fetch time (default is before earliest TGC data)
var lastDistFetch = '2014-09-09 12:13:14Z';	// last distance fetch time (default is before earliest TGC data)

function getTGCData(callback, wantDists) {
	$.getJSON('tgcsystems.json', function(data) {
		lastFetch = data.date+'Z';
		systemsMap = {};
		addSystems(data.systems);
		logAppend('Loaded tgcsystems.json: data up to '+data.date+'. Total number of systems: '+Object.keys(systemsMap).length+'\n');
	}).fail(function() {
		logAppend('Failed to read from tgcsystems.json\n');
	}).always(function() {
		// update with any additional data from the server
		updateTGCData(
			wantDists ? 
				function() {
					$.getJSON('tgcdistances.json', function(data) {
						lastDistFetch = data.date+'Z';
						var dists = addDistances(data.distances);
						logAppend('Loaded tgcdistances.json: data up to '+data.date+'. Added '+dists+'\n');
					}).fail(function() {
						logAppend('Failed to read from tgcdistances.json\n');
					}).always(function() {
						fetchTGCDistances(callback);
					});
				}
				: callback
		);
	});
}

function addDistances(distances) {
	var count = 0;
	$.each(distances, function() {
		var s1key = nameKey(this.name);
		if (!(s1key in systemsMap)) {
			console.log('Unknown system '+this.name+' in distance data');
			return;
		}
		$.each(this.refs, function() {
			var s2key = nameKey(this.name);
			if (!(s2key in systemsMap)) {
				console.log('Unknown system '+this.name+' in distance data');
				return;
			}
			count++;
			if (systemsMap[s1key].calculated) {
				if (!('distances' in systemsMap[s1key])) systemsMap[s1key].distances = [];
				systemsMap[s1key].distances.push({system: systemsMap[s2key].name, distance: this.dist});
			}
			if (systemsMap[s2key].calculated) {
				if (!('distances' in systemsMap[s2key])) systemsMap[s2key].distances = [];
				systemsMap[s2key].distances.push({system: systemsMap[s1key].name, distance: this.dist});
			}
		});
	});
	return count;
}

// TODO do something with count/rejected
function addSystems(systems) {
	var count = 0; rejected = 0;
	$.each(systems, function() {
		var key = nameKey(this.name);
		if (!(key in systemsMap) || systemsMap[key].contributor !== 'FD' || true) {
			// we don't replace FD systems with new data
			systemsMap[key] = {
				x: this.coord[0],
				y: this.coord[1],
				z: this.coord[2],
				name: this.name,
				calculated: this.commandercreate !== 'FD',
				cr: this.cr,
				contributor: this.commandercreate ? this.commandercreate : '(unknown)',
				contributed: this.createdate
			};
			count++;
		} else {
			rejected++;
		}
	});
//	if (rejected > 0) msg += 'Rejected '+rejected+' systems. ';
}

function updateTGCData(callback) {
	$.ajax({
		type: 'POST',
		contentType: 'application/json; charset=utf-8',
		url: 'http://edstarcoordinator.com/api.asmx/GetSystems',
		data: JSON.stringify({data: {
			ver: 2,
			outputmode: 2,
			filter: {
				cr: 1,
				date: lastFetch
			}
		}}),
		dataType: 'json',
		success: function(data, status, xhr) {
			data = data.d;
			//console.log(JSON.stringify(data, null, 2));
			if (data.status.input[0].status.statusnum !== 0) {
				logAppend('Error from TGC server: '+data.status.input[0].status.statusnum +' '+data.status.input[0].status.msg+'\n');
			} else {
				addSystems(data.systems);
				logAppend('Fetched '+data.systems.length+' systems from TGC. Total number of systems: '+Object.keys(systemsMap).length+'\n');
			}
			callback();
		},
		error: function(xhr, status, error) {
			//console.log(xhr.responseText);
			logAppend(error+'\n');
			console.log('Error from TGC server: '+error);
			console.log('Request was:');
			console.log(JSON.stringify(query, null, 2));
			callback();
		}
	});
}

function fetchTGCDistances(callback) {
	$.ajax({
		type: 'POST',
		contentType: 'application/json; charset=utf-8',
		url: 'http://edstarcoordinator.com/api.asmx/GetDistances',
		data: JSON.stringify({data: {
			ver: 2,
			outputmode: 2,
			filter: {
				cr: 0,
				date: lastFetch
			}
		}}),
		dataType: 'json',
		success: function(data, status, xhr) {
			data = data.d;
			//console.log(JSON.stringify(data, null, 2));
			if (data.status.input[0].status.statusnum !== 0) {
				logAppend('Error from TGC server: '+data.status.input[0].status.statusnum +' '+data.status.input[0].status.msg+'\n');
			} else {
				var dists = addDistances(data.distances);
				logAppend('Fetched '+dists+' distances from TGC\n');
			}
			callback();
		},
		error: function(xhr, status, error) {
			//console.log(xhr.responseText);
			logAppend(error+'\n');
			console.log('Error from TGC server: '+error);
			console.log('Request was:');
			console.log(JSON.stringify(query, null, 2));
			callback();
		}
	});
}


function logAppend(str) {
	console.log(str);
}

// move to trilateration.js??
function nameKey(n) {
	return $.trim(n.toLowerCase());
}