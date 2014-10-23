// dists is an array of reference objects (properties x, y, z, distance)
// returns an object containing the best candidate found (properties x, y, z, totalSqErr, i1, i2, i3)
// i1, i2, i3 are the indexes into dists[] that were reference points for the candidate
// totalSqErr is the total of the squares of the difference between the supplied distance and the calculated distance to each system in dists[]
function getBestCandidate(dists) {
	var i1 = 0, i2 = 1, i3 = 2, i4;
	var bestCandidate = null;

	// run the trilateration for each combination of 3 reference systems in the set of systems we have distance data for
	// we look for the best candidate over all trilaterations based on the lowest total (squared) error in the calculated
	// distances to all the reference systems
	for (i1 = 0; i1 < dists.length; i1++) {
		for (i2 = i1+1; i2 < dists.length; i2++) {
			for (i3 = i2+1; i3 < dists.length; i3++) {
		 		var candidates = getCandidates(dists, i1, i2, i3);
		 		if (candidates.length == 2) {
					candidates[0].totalSqErr = 0;
					candidates[1].totalSqErr = 0;
					
		 			for (i4 = 0; i4 < dists.length; i4++) {
						var err = Math.abs(dist(candidates[0], dists[i4]) - dists[i4].distance);
		 				candidates[0].totalSqErr += err*err;
		 				err = Math.abs(dist(candidates[1], dists[i4]) - dists[i4].distance);
		 				candidates[1].totalSqErr += err*err;
		 			}
					if (bestCandidate === null || bestCandidate.totalSqErr > candidates[0].totalSqErr) {
						bestCandidate = candidates[0];
						bestCandidate.i1 = i1;
						bestCandidate.i2 = i2;
						bestCandidate.i3 = i3;
						//console.log("best candidate so far: (1st) "+JSON.stringify(bestCandidate,2));
					}
					if (bestCandidate.totalSqErr > candidates[1].totalSqErr) {
						bestCandidate = candidates[1];
						bestCandidate.i1 = i1;
						bestCandidate.i2 = i2;
						bestCandidate.i3 = i3;
						//console.log("best candidate so far: (2nd) "+JSON.stringify(bestCandidate,2));
					}
				}
			}
		}
	}
	return bestCandidate;
}

// dists is an array of reference objects (properties x, y, z, distance)
// i1, i2, i3 indexes of the references to use to calculate the candidates
// returns an array of two points (properties x, y, z). if the supplied reference points are disjoint then an empty array is returned
function getCandidates(dists, i1, i2, i3) {
	var p1 = dists[i1];
	var p2 = dists[i2];
	var p3 = dists[i3];
	
	var p1p2 = diff(p2, p1);
	var d = length(p1p2);
	var ex = scalarProd(1/d, p1p2);
	var p1p3 = diff(p3, p1);
	var i = dotProd(ex, p1p3);
	var ey = diff(p1p3, scalarProd(i, ex));
	ey = scalarProd( 1/length(ey), ey);
	var j = dotProd(ey, diff(p3, p1));

	var x = (p1.distance*p1.distance - p2.distance*p2.distance + d*d) / (2*d);
	var y = ((p1.distance*p1.distance - p3.distance*p3.distance + i*i + j*j) / (2*j)) - (i*x/j);
	var zsq = p1.distance*p1.distance - x*x - y*y;
	if (zsq < 0) {
		//console.log("inconsistent distances (z^2 = "+zsq+")");
		return [];
	} else {
		var z = Math.sqrt(zsq);
		var ez = crossProd(ex, ey);
		var coord1 = sum(sum(p1,scalarProd(x,ex)),scalarProd(y,ey));
		var coord2 = diff(coord1,scalarProd(z,ez));
		coord1 = sum(coord1,scalarProd(z,ez));
		return [coord1, coord2];
	}
}

// dists is an array of reference objects (properties x, y, z, distance)
// p is a vector (properties x, y, z)
// returns the RMS error between the distances as calculated from the coordinates and the distances supplied
function getError(p, dists) {
	var err = 0;
	$.each(dists, function() {
		var e = dist(this, p) - this.distance;
		err += e*e;
	});
	return Math.sqrt(err/dists.length);
}

// returns a vector with the components of v rounded to 1/32
function gridLocation(v) {
	return {
		x: (Math.round(v.x*32)/32),
		y: (Math.round(v.y*32)/32),
		z: (Math.round(v.z*32)/32)
	};
}

function vectorToString(v) {
	return "("+v.x+", "+v.y+", "+v.z+")";
}

// copies the vector components (x, y, z properties) to object o
function setVector(o, v) {
	o.x = v.x;
	o.y = v.y;
	o.z = v.z;
}

// p1 and p2 are objects that have x, y, and z properties
// returns the scalar (dot) product p1 . p2
function dotProd(p1, p2) {
	return p1.x*p2.x + p1.y*p2.y + p1.z*p2.z;
}

// p1 and p2 are objects that have x, y, and z properties
// returns the vector (cross) product p1 x p2
function crossProd(p1, p2) {
	return {
		x: p1.y*p2.z - p1.z*p2.y,
		y: p1.z*p2.x - p1.x*p2.z,
		z: p1.x*p2.y - p1.y*p2.x
	};
}

// v is a vector obejct with x, y, and z properties
// s is a scalar value
// returns a new vector object containing the scalar product of s and v
function scalarProd(s, v) {
	return {
		x: s * v.x,
		y: s * v.y,
		z: s * v.z
	};
}

// p1 and p2 are objects that have x, y, and z properties
// returns the distance between p1 and p2
function dist(p1, p2) {
	return length(diff(p2,p1));
}

// v is a vector obejct with x, y, and z properties
// returns the length of v
function length(v) {
	return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
}

var fround = Math.fround || function(x) { return x };

// p1 and p2 are objects that have x, y, and z properties
// returns the distance between p1 and p2, calculated as single precision (as ED does)
function distf(p1, p2) {
	return lengthf(diff(p2,p1));
}

// v is a vector obejct with x, y, and z properties
// returns the length of v
function lengthf(v) {
	return fround(Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z));
}

// p1 and p2 are objects that have x, y, and z properties
// returns the difference p1 - p2 as a vector object (with x, y, z properties), calculated as single precision (as ED does)
function diff(p1, p2) {
	return {
		x: p1.x - p2.x,
		y: p1.y - p2.y,
		z: p1.z - p2.z
	};
}

// p1 and p2 are objects that have x, y, and z properties
// returns the sum p1 + p2 as a vector object (with x, y, z properties)
function sum(p1, p2) {
	return {
		x: p1.x + p2.x,
		y: p1.y + p2.y,
		z: p1.z + p2.z
	};
}

// dists is an array of four reference objects (properties x, y, z, distance)
// returns coordinate object (properties x, y, z)
function tunaMageCoords(dists) {
	var b = diff(dists[1], dists[0]);	// 2nd system relative to 1st system
	var c = diff(dists[2], dists[0]);	// 3rd system relative to 1st system
	var d = diff(dists[3], dists[0]);	// 4th system relative to 1st system

	var ea = dists[0].distance*dists[0].distance;
	var eb = dists[1].distance*dists[1].distance;
	var ec = dists[2].distance*dists[2].distance;
	var ed = dists[3].distance*dists[3].distance;

	var p = (ea-eb+b.x*b.x+b.y*b.y+b.z*b.z)/2;
	var q = (ea-ec+c.x*c.x+c.y*c.y+c.z*c.z)/2;
	var r = (ea-ed+d.x*d.x+d.y*d.y+d.z*d.z)/2;

	var ez =((p*d.x-r*b.x)*(b.y*c.x-c.y*b.x)/(b.y*d.x-d.y*b.x)-(p*c.x-q*b.x))/(((b.z*d.x-d.z*b.x)*(b.y*c.x-c.y*b.x)/(b.y*d.x-d.y*b.x))-(b.z*c.x-c.z*b.x));
	var ey =((p*c.x-q*b.x)-ez*(b.z*c.x-c.z*b.x))/(b.y*c.x-c.y*b.x);
	var ex =(p-ey*b.y-ez*b.z)/b.x;

	return sum(dists[0], {x: ex, y: ey, z: ez});
}

//-----------------------------------------------------------------------------------------
// Miscellaneous common functions
//-----------------------------------------------------------------------------------------

function updateSortArrow(event, data) {
// data.column - the index of the column sorted after a click
// data.direction - the sorting direction (either asc or desc)
	var th = $(this).find("th");
	th.find(".arrow").remove();
	var arrow = data.direction === "asc" ? "\u2191" : "\u2193";
	th.eq(data.column).append('<span class="arrow">' + arrow +'</span>');
}

// sort function that treats missing value (and values that can't be parsed as floats) as the largest values
function sortOptionalFloat(a,b) {
	if (isNaN(parseFloat(a))) {
		if (isNaN(parseFloat(b))) return 0;
		return 1;
	}
	if (isNaN(parseFloat(b))) return -1;
	return parseFloat(a)-parseFloat(b);
}

// sort function that treats missing value (and values that can't be parsed as integers) as the largest values
function sortOptionalInt(a,b) {
	if (isNaN(parseInt(a))) {
		if (isNaN(parseInt(b))) return 0;
		return 1;
	}
	if (isNaN(parseInt(b))) return -1;
	return parseInt(a)-parseInt(b);
}

// returns a string containing an sql insert statement for TradeDangerous
function getSQL(s) {
	var quotedName = s.name.replace("'","''");
	var d = (new Date()).toISOString().replace('T',' ').substr(0,19);
	return "INSERT INTO \"System\" VALUES(,'"+quotedName+"',"+s.x+","+s.y+","+s.z+",'"+d+"');\n";
}

// selects the contents of the current node (this)
// should be called in the context of the node to be selected (i.e. this === the node)
function selectAll() {
	if (window.getSelection) {
		var selection = window.getSelection();            
		var range = document.createRange();
		range.selectNodeContents(this);
		selection.removeAllRanges();
		selection.addRange(range);
	}
}

// returns a function that toggles the specified target element and changes the text of the
// this element based on the the current visibility of the target.
// the returned function can be set as a jQuery event handler
function getToggle(target, visibleText, hiddenText) {
	return function() {
		var $ctrl = $(this);
		$ctrl.text($(target).is(":visible") ? hiddenText : visibleText).attr("disabled", true);
		$(target).toggle("fast", function() {
			$ctrl.attr("disabled", false);
		});
	};
}
