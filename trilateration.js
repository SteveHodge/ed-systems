// dists is an array of reference objects (properties x, y, z, dist)
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
						var err = Math.abs(dist(candidates[0], dists[i4]) - dists[i4].dist);
		 				candidates[0].totalSqErr += err*err;
		 				err = Math.abs(dist(candidates[1], dists[i4]) - dists[i4].dist);
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

// dists is an array of reference objects (properties x, y, z, dist)
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

	var x = (p1.dist*p1.dist - p2.dist*p2.dist + d*d) / (2*d);
	var y = ((p1.dist*p1.dist - p3.dist*p3.dist + i*i + j*j) / (2*j)) - (i*x/j);
	var zsq = p1.dist*p1.dist - x*x - y*y;
	if (zsq < 0) {
		//console.log("inconsistent distances (z^2 = "+zsq+")");
		return [];
	} else {
		var z = Math.sqrt(zsq);
		var ez = crossProd(ex, ey);
		var coord1 = sum(sum(p1,scalarProd(x,ex)),scalarProd(y,ey));
		var coord2 = diff(coord1,scalarProd(z,ez));
		coord1 = sum(coord1,scalarProd(z,ez));
		//console.log("ex = "+vectorToString(ex)+", ey = "+vectorToString(ey)+", ez = "+vectorToString(ez));
		//console.log("candidate 1: ("+(coord1.x/32.0)+", "+(coord1.y/32.0)+", "+(coord1.z/32.0)+")");
		//console.log("candidate 2: ("+(coord2.x/32.0)+", "+(coord2.y/32.0)+", "+(coord2.z/32.0)+")");
		
		return [coord1, coord2];
	}
}

function vectorToString(v) {
	return "("+v.x+", "+v.y+", "+v.z+")";
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

// p1 and p2 are objects that have x, y, and z properties
// returns the difference p1 - p2 as a vector object (with x, y, z properties)
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

// dists is an array of four reference objects (properties x, y, z, dist)
// returns coordinate object (properties x, y, z)
function tunamageCoords(dists) {
	var b = diff(dists[1], dists[0]);	// 2nd system relative to 1st system
	var c = diff(dists[2], dists[0]);	// 3rd system relative to 1st system
	var d = diff(dists[3], dists[0]);	// 4th system relative to 1st system

	var ea = dists[0].dist*dists[0].dist;
	var eb = dists[1].dist*dists[1].dist;
	var ec = dists[2].dist*dists[2].dist;
	var ed = dists[3].dist*dists[3].dist;

	var p = (ea-eb+b.x*b.x+b.y*b.y+b.z*b.z)/2;
	var q = (ea-ec+c.x*c.x+c.y*c.y+c.z*c.z)/2;
	var r = (ea-ed+d.x*d.x+d.y*d.y+d.z*d.z)/2;

	var ez =((p*d.x-r*b.x)*(b.y*c.x-c.y*b.x)/(b.y*d.x-d.y*b.x)-(p*c.x-q*b.x))/(((b.z*d.x-d.z*b.x)*(b.y*c.x-c.y*b.x)/(b.y*d.x-d.y*b.x))-(b.z*c.x-c.z*b.x));
	var ey =((p*c.x-q*b.x)-ez*(b.z*c.x-c.z*b.x))/(b.y*c.x-c.y*b.x);
	var ex =(p-ey*b.y-ez*b.z)/b.x;

	return sum(dists[0], {x: ex, y: ey, z: ez});
}