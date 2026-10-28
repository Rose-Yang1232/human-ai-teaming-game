// To do
// see if there is a U curve when stability parameter is very high
// simulate discounting based on expect num of new objects
// Full working version of the AI Planner with stabliity threshold and notion of alpha

// "Hold position" result (sentinel ID -2). Returned whenever the agent has nothing
// worth/possible to intercept, so it stays put instead of drifting to the
// geometric center and sitting idle ("the AI got stuck").
function makeHoldSolution(player) {
    const hold = {
        maxValue: 0,
        minDistance: 0,
        minTime: 0,
        interceptionOrder: [],
        interceptLocations: [[player.x, player.y]],
        interceptTimes: [0],
        ID: -2,
    };
    const firstHold = {
        x: player.x,
        y: player.y,
        ID: -2,
        interceptTime: 0,
    };
    return [firstHold, hold];
}

// MS32
function runAIPlanner( objects, player , observableRadius , center, whAgent, stabilityThreshold, prevBestSol, frame, alpha) {
    // Function to run the AI planner

    // First, find all objects that have not been intercepted yet
    let ObjectsNI;
    if ((whAgent == 'human') || whAgent == 'collab') {
        ObjectsNI = objects.filter(object => !object.intercepted);
    } else if (whAgent == 'AI') {
        ObjectsNI = objects.filter(object => !object.AIintercepted);
    }

    // No interceptable targets (for collab: none left after the caller's filters):
    // return an explicit hold-still sentinel. There is no "return to center" option.
    if (ObjectsNI.length === 0) {
        return makeHoldSolution(player);
    }

    // Convert the screen coordinates to normalized coordinates where circle has radius 1 and center is at (0,0)
    let numObjects = ObjectsNI.length; 
    let objectPositionsX = ObjectsNI.map(object => (object.x - center.x) / observableRadius);
    let objectPositionsY = ObjectsNI.map(object => (object.y - center.y) / observableRadius);
    // Match the per-frame displacement actually applied in the animation loop
    // (obj.vx * obj.speed * animationSpeedFactor). player.velocity already
    // includes animationSpeedFactor, so both sides of the intercept math use
    // the same units and the computed intercept point is where the object
    // really is at travelTime frames.
    const _animFactor = (typeof settings !== 'undefined' && typeof settings.animationSpeedFactor === 'number')
        ? settings.animationSpeedFactor
        : 1;
    let objectVelocitiesX = ObjectsNI.map(object => (object.vx * object.speed * _animFactor) / observableRadius);
    let objectVelocitiesY = ObjectsNI.map(object => (object.vy * object.speed * _animFactor) / observableRadius);
    // let objectValues = ObjectsNI.map(object => object.fill / object.size); 
    let objectValues = ObjectsNI.map(object => object.value);
    // === New: policy-based reweighting for the collab AI teammate ===
    if (typeof settings !== 'undefined' && whAgent === 'collab') {
        const objective = settings.aiObjective || 'self-bonus';
        const aiBonus = typeof settings.aiBonusPerTriangle === 'number'
            ? settings.aiBonusPerTriangle
            : 1;

        objectValues = objectValues.map((baseVal, idx) => {
            const obj = ObjectsNI[idx];

            // Team contribution: team always gets baseVal if someone catches it
            const team = baseVal;
             // Individual contributions are *counts* (0/1), not weighted by urgency
            const aiInd    = (obj.shape === 'triangle') ? aiBonus : 0;
            const humanInd = (obj.shape === 'square')   ? 2 : 0; // reserved for future (human-aware) policies


            if (objective === 'self-bonus') {
                // Self: only cares about AI-individual triangles
            return aiInd;
            } else if (objective === 'self-urgency-bonus') {
                // Self: urgency + AI bonus
            return team + aiInd;
            } else if (objective === 'team') {
                // Team: ignore AI-individual; pure team value
                return team;

            }

        // Default: old behavior (roughly team-based)
        return baseVal;
    });
}

    let ID = ObjectsNI.map(object => object.ID ); 
    let circleRadius = +1.00;
    let playerStartX = ( player.x - center.x ) / observableRadius;
    let playerStartY = ( player.y - center.y ) / observableRadius; 
    let playerSpeed = player.velocity / observableRadius;

    
    // === DEBUG: log per-target objective values (gate: window.AI_DEBUG_LOG = true) ===
    let __aiDebug = (typeof window !== 'undefined' && window.AI_DEBUG_LOG === true);
    let __aiDebugRows = null;
    if (__aiDebug && whAgent === 'collab') {
        try {
            const objNow = (typeof settings !== 'undefined' ? (settings.aiObjective || 'self-bonus') : 'n/a');
            const bonusNow = (typeof settings !== 'undefined' && typeof settings.aiBonusPerTriangle === 'number') ? settings.aiBonusPerTriangle : 1;
            __aiDebugRows = [];
            for (let i = 0; i < ObjectsNI.length; i++) {
                const o = ObjectsNI[i];
                __aiDebugRows.push({
                    ID: o.ID,
                    shape: o.shape,
                    urgency: o.value,
                    plannerValue: objectValues[i]
                });
            }
            console.groupCollapsed('[AI planner] frame=' + frame + ' | objective=' + objNow + ' | aiBonus=' + bonusNow);
            console.log('Per-target values handed to planner:');
            console.table(__aiDebugRows);
        } catch (e) { /* logging must never break the game */ }
    }

    // Run the planner on these normalized coordinates
    // MS8
    let bestSol, bestByFirst, allPlans;
    try {
        [ bestSol, bestByFirst, allPlans ] = planSingleFrame(playerStartX, playerStartY, playerSpeed, objectPositionsX, objectPositionsY,
            objectVelocitiesX, objectVelocitiesY, objectValues, circleRadius, ID, alpha, frame, __aiDebug && whAgent === 'collab');
    } catch (e) {
        // planSingleFrame throws when NONE of the candidate targets can be intercepted
        // from the player's current position (all leaving the field / too fast, etc.).
        // Degrade gracefully to "hold position" instead of letting the exception
        // bubble up and freeze the game loop.
        return makeHoldSolution(player);
    }

    // Planner returned an empty plan (no interceptable target) -> hold position.
    if (!bestSol.interceptionOrder || bestSol.interceptionOrder.length === 0) {
        return makeHoldSolution(player);
    }


    // Do we change the best solution to maintain stability?
    // Switch targets only if the new best plan beats continuing with the previous target
    // by stabilityThreshold. Both scores are planned from the current state; the previous
    // plan's stored maxValue is not used, since it was scored from an earlier position.
    let stabilityRatio = null; // logged below
    if ((stabilityThreshold != null) && (prevBestSol != null) && (bestSol.ID != prevBestSol.ID)) {
        // Best plan that starts with the previous target (absent if it can no longer be intercepted first)
        let keepPlan = bestByFirst.get(prevBestSol.ID);
        if (keepPlan) {
            // What is the improvement (if any) of switching over continuing?
            let ratioScores = ( bestSol.maxValue + 0.0001 ) / ( keepPlan.maxValue + 0.0001 );
            stabilityRatio = ratioScores;
            if (ratioScores < stabilityThreshold) {
                bestSol = keepPlan;
            }
        }
    }

    // Convert all coordinates back to screen coordinates
    let solLength = bestSol.interceptionOrder.length;
    for (let i=0; i<solLength; i++) {
         bestSol.interceptLocations[i][0] = ( bestSol.interceptLocations[i][0] * observableRadius ) + center.x;
         bestSol.interceptLocations[i][1] = ( bestSol.interceptLocations[i][1] * observableRadius ) + center.y;       
    }

     

    //if (bestSol.interceptLocations[0] == null) {
    //    console.log( 'check');
    //}
    
    // Create a new object with just the coordinates for the first interception
    let firstStep = { x: bestSol.interceptLocations[0][0] , 
                      y: bestSol.interceptLocations[0][1], 
                      ID: bestSol.ID,
                      interceptTime: bestSol.interceptTimes[0] }; 

    //console.log( "Current target ID: " + firstStep.ID );

    // === DEBUG: log chosen plan + stability decision ===
    if (__aiDebug && whAgent === 'collab') {
        try {
            const chosenIdx = (__aiDebugRows || []).findIndex(r => r.ID === bestSol.ID);
            const chosenRow = chosenIdx >= 0 ? __aiDebugRows[chosenIdx] : null;
            console.log('Chosen target ID=' + bestSol.ID
                + (chosenRow ? (' (shape=' + chosenRow.shape + ', urgency=' + chosenRow.urgency + ', plannerValue=' + chosenRow.plannerValue + ')') : '')
                + ' | totalDiscountedValue=' + (typeof bestSol.maxValue === 'number' ? bestSol.maxValue.toFixed(4) : bestSol.maxValue)
                + ' | totalTime=' + (typeof bestSol.minTime === 'number' ? bestSol.minTime.toFixed(4) : bestSol.minTime)
                + ' | sequence=' + JSON.stringify(bestSol.interceptionOrder)
            );
            if (prevBestSol != null) {
                const ratio = stabilityRatio;
                const reverted = (ratio != null) && (bestSol.ID === prevBestSol.ID);
                console.log('Stability check: prevID=' + prevBestSol.ID
                    + ', threshold=' + stabilityThreshold
                    + ', ratio(new/continue)=' + (ratio == null ? 'n/a (same target, or previous no longer reachable)' : (isFinite(ratio) ? ratio.toFixed(4) : ratio))
                    + ', kept previous? ' + reverted);
            }

            // Score decomposition: chosen plan + top 3 alternative sequences
            if (allPlans && allPlans.length > 0) {
                const shapeOf = (id) => {
                    const r = (__aiDebugRows || []).find(row => row.ID === id);
                    return r ? r.shape : '?';
                };
                const legRows = (alt) => alt.legs.map((leg, k) => leg.failed
                    ? { step: k + 1, ID: leg.ID, shape: shapeOf(leg.ID), result: 'FAILED (leaves field first)' }
                    : { step: k + 1, ID: leg.ID, shape: shapeOf(leg.ID),
                        value: leg.value,
                        legDistance: +leg.legDistance.toFixed(3),
                        cumDistance: +leg.cumDistance.toFixed(3),
                        discount: +leg.discount.toFixed(3),
                        contribution: +leg.contribution.toFixed(3),
                        frames: +leg.time.toFixed(1) });
                // Different orders can collapse to the same catches when a leg fails;
                // keep one entry per resulting sequence.
                const seqKey = (plan) => JSON.stringify(plan.interceptionOrder);
                const bySeq = new Map();
                allPlans.forEach(plan => {
                    const prev = bySeq.get(seqKey(plan));
                    if (!prev || plan.maxValue > prev.maxValue
                        || (plan.maxValue === prev.maxValue && plan.minTime < prev.minTime)) {
                        bySeq.set(seqKey(plan), plan);
                    }
                });
                const altsSorted = Array.from(bySeq.values()).sort((a, b) =>
                    (b.maxValue - a.maxValue) || (a.minTime - b.minTime));

                console.log('Score = Σ value × alpha^cumDistance  (alpha=' + alpha
                    + ', distances in circle radii, cumDistance = distance travelled from the AI\'s position up to that catch). '
                    + allPlans.length + ' orders evaluated, ' + altsSorted.length + ' distinct sequences, '
                    + bestByFirst.size + ' possible first targets.');

                console.log('CHOSEN first target ID=' + bestSol.ID + ' (' + shapeOf(bestSol.ID) + ')'
                    + ' | score=' + bestSol.maxValue.toFixed(3)
                    + ' | sequence=' + JSON.stringify(bestSol.interceptionOrder));
                console.table(legRows(bestSol));

                const others = altsSorted.filter(a => seqKey(a) !== seqKey(bestSol)).slice(0, 3);
                const chosenScore = bestSol.maxValue;
                others.forEach((alt, i) => {
                    const gap = alt.maxValue - chosenScore;
                    const pct = chosenScore !== 0 ? (100 * alt.maxValue / chosenScore).toFixed(1) + '% of chosen' : '';
                    console.log('ALT #' + (i + 1) + ' sequence starting ID=' + alt.ID + ' (' + shapeOf(alt.ID) + ')'
                        + ' | score=' + alt.maxValue.toFixed(3)
                        + ' (' + (gap >= 0 ? '+' : '') + gap.toFixed(3) + ', ' + pct + ')'
                        + ' | sequence=' + JSON.stringify(alt.interceptionOrder));
                    console.table(legRows(alt));
                });
                if (others.length === 0) console.log('No alternative sequences (only one reachable target).');
            }
            console.groupEnd();
        } catch (e) { /* logging must never break the game */ }
    }

    return [ firstStep, bestSol ];
} 


// MS7
function findIndex(value, array) {
    return array.indexOf(value);
}

function findIndexByValue(value, array, field) {
    return array.findIndex(obj => obj[field] === value);
}

// MS8
function sortArray(values) {
    // Clone the array to avoid mutating the original array
    const clonedArray = [...values];
    // Sort the cloned array
    return clonedArray.sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
  }
  

// Returns [bestSol, bestByFirst, allPlans]. bestByFirst maps each reachable first target's ID to
// the best sequence that starts with it (used by the stability rule).
// recordLegs (optional): also store a per-catch breakdown of each score, and collect every
// evaluated plan in allPlans (debug logging only; allPlans is null otherwise).
function planSingleFrame(playerStartX, playerStartY, playerSpeed, objectPositionsX, objectPositionsY, objectVelocitiesX, objectVelocitiesY, objectValues, circleRadius, ID, alpha, frame, recordLegs ) {
    const numObjects = objectPositionsX.length;
    if (numObjects==0) {
        throw new Error( 'Expected at least one object');
    }
    
    // debugging
    //if ((numObjects > 1) && ( frame==159)) {
    //    console.log( "here");
    //}
    
    // Initialize the best solution as "nothing found yet"
    let bestSol = {
        maxValue: -Infinity,
        minDistance: +Infinity,
        minTime: +Infinity,
        interceptionOrder: [],
        interceptLocations: [],
        interceptTimes: [ +Infinity ],
        ID: [],
    };

    // Best sequence of interceptions, conditional on first visiting each object
    let bestByFirst = new Map();
    let allPlans = recordLegs ? [] : null;
    const isBetterPlan = (a, b) => (a.maxValue > b.maxValue) || (a.maxValue === b.maxValue && a.minTime < b.minTime);

    let timeToLeaveCircle = [];
    for (let i=0; i<numObjects; i++) {
        timeToLeaveCircle[i] = timeBeforeLeavingCircle(objectPositionsX[i], objectPositionsY[i], objectVelocitiesX[i], objectVelocitiesY[i], circleRadius);
    }

    // MS8
    // Sort the times of objects leaving the circle
    let sortedTimes = sortArray( timeToLeaveCircle );
    sortedTimes.push( Infinity );

    // Loop over all orders of three objects
    for (let o1 = 0; o1 < numObjects; o1++) {
        for (let o2 = 0; o2 < numObjects; o2++) {
            for (let o3 = 0; o3 < numObjects; o3++) {
                let order = [];
                if (numObjects == 1) {
                    order = [ o1 ];
                } else if ((o1 != o2) && (numObjects == 2)) {
                    order = [ o1, o2 ];
                } else if ((numObjects >= 3) && (o1 !=o2 ) && (o2 != o3) && (o1!=o3)) {
                    order = [ o1, o2, o3 ];
                }
                    
                let planningDepth = order.length;
                if (planningDepth >= 1) {
                    let totalValue = 0;
                    let totalDistance = 0;
                    let totalTime = 0;
                    let playerPosX = playerStartX;
                    let playerPosY = playerStartY;
                    let currentObjectPositionsX = objectPositionsX.slice();
                    let currentObjectPositionsY = objectPositionsY.slice();
                    let interceptLocationsBest = [];
                    let interceptTime = [];
                    let countj = 0;
                    let interceptionOrder = [];
                    let firstIntercept = []; 
                    let numObjectsLeft = 0; 
                    let firstObjectIdx = [];
                    let legs = recordLegs ? [] : null;

                    for (let j = 0; j < planningDepth; j++) {
                        let objectIdx = order[j];
                        let idnow = ID[objectIdx];

                        let [success, timeToIntercept, interceptPosX, interceptPosY, distance] = attemptIntercept(
                            playerPosX, playerPosY, playerSpeed,
                            currentObjectPositionsX[objectIdx], currentObjectPositionsY[objectIdx],
                            objectVelocitiesX[objectIdx], objectVelocitiesY[objectIdx],
                            circleRadius
                        );
                            
                        if (success) {
                            countj++;
                            if (countj==1) { 
                                firstObjectIdx = objectIdx;
                            }
                            interceptionOrder.push(idnow);
                            let valueNow = objectValues[objectIdx];
                            totalTime += timeToIntercept;
                            totalDistance += distance;
                            

                            // MS8
                            while (totalTime > sortedTimes[ numObjectsLeft]) {
                                numObjectsLeft++;
                            }

                            // MS8
                            //let alpha = 0.9; 
                            //totalValue += valueNow;
                            // TODO: the discounting is weird: how many more object is left the field 
                            // using the last line : j - if you have three targets: the first target is not discounted at all
                            // first: decide what is alpha 
                            // totalValue += valueNow * Math.pow( alpha , numObjectsLeft );
                            let discount = Math.pow( alpha , totalDistance );
                            totalValue += valueNow * discount;
                            if (legs) {
                                legs.push({ ID: idnow, value: valueNow, legDistance: distance,
                                            cumDistance: totalDistance, discount: discount,
                                            contribution: valueNow * discount, time: timeToIntercept });
                            }
                            //totalValue += valueNow * Math.pow( alpha , totalTime );
                            //totalValue += valueNow * Math.pow( alpha , j );
                            
                            playerPosX = interceptPosX;
                            playerPosY = interceptPosY;
                            interceptLocationsBest.push([interceptPosX, interceptPosY]);
                            interceptTime.push( timeToIntercept);

                            // MS30
                            for (let kk=0; kk<numObjects; kk++) {
                                currentObjectPositionsX[kk] = currentObjectPositionsX[kk] + objectVelocitiesX[kk] * timeToIntercept;
                                currentObjectPositionsY[kk] = currentObjectPositionsY[kk] + objectVelocitiesY[kk] * timeToIntercept;
                            }
                        } else if (legs) {
                            legs.push({ ID: idnow, failed: true });
                        }

                        if ((j==0) && (success)) {
                            firstIntercept = [interceptPosX, interceptPosY]; 
                        }
                    }


                    if (countj > 0) {
                        let plan = {
                            maxValue: totalValue,
                            minDistance: totalDistance,
                            minTime: totalTime,
                            interceptionOrder: interceptionOrder,
                            interceptLocations: interceptLocationsBest,
                            interceptTimes: interceptTime,
                            ID: ID[ firstObjectIdx ], // store the ID of the object that is targeted for first interception // MS20
                            legs: legs,
                        };

                        if (allPlans) allPlans.push(plan);

                        let prevForFirst = bestByFirst.get(plan.ID);
                        if (!prevForFirst || isBetterPlan(plan, prevForFirst)) {
                            bestByFirst.set(plan.ID, plan);
                        }
                        if (isBetterPlan(plan, bestSol)) {
                            bestSol = plan;
                        }
                    }
                    
                }
            }
        }
    }

    if (bestSol.interceptLocations[0] == null) {
        throw new Error( 'Problem....');
    }

                                                                                                    
    return [ bestSol, bestByFirst, allPlans ];
}
function attemptIntercept(playerPosX, playerPosY, playerSpeed, objectPosX, objectPosY, objectVelX, objectVelY, circleRadius) {
    let success = false;
    let travelTime = Infinity;
    let interceptPosX = NaN;
    let interceptPosY = NaN;
    let totalDistanceTraveled = Infinity;

    // Check if the object is within the circle initially
    if (Math.sqrt(objectPosX ** 2 + objectPosY ** 2) > circleRadius) {
        return [ success, travelTime, interceptPosX, interceptPosY, totalDistanceTraveled ];
    }

    // Initial relative position from the player to the object
    let relativePosX = objectPosX - playerPosX;
    let relativePosY = objectPosY - playerPosY;

    // Solving quadratic equation
    let A = objectVelX ** 2 + objectVelY ** 2 - playerSpeed ** 2;
    let B = 2 * (relativePosX * objectVelX + relativePosY * objectVelY);
    let C = relativePosX ** 2 + relativePosY ** 2;

    if (C === 0) {
        // Already at the target, including when both are stationary.
        travelTime = 0;
    } else if (A === 0) {
        // Equal speeds: the quadratic reduces to B*t + C = 0.
        // With C > 0, only B < 0 gives a future meeting.
        if (B < 0) travelTime = -C / B;
    } else {
        const discriminant = B ** 2 - 4 * A * C;
        if (discriminant >= 0) {
            // Stable quadratic roots avoid subtracting nearly equal numbers
            // when player and target speeds are close but not identical.
            const root = Math.sqrt(discriminant);
            const q = -0.5 * (B + (B >= 0 ? root : -root));
            const t1 = q / A;
            const t2 = C / q;
            if (t1 >= 0) travelTime = t1;
            if (t2 >= 0) travelTime = Math.min(travelTime, t2);
        }
    }

    if (!Number.isFinite(travelTime) || travelTime < 0) {
        return [ success, Infinity, interceptPosX, interceptPosY, totalDistanceTraveled ];
    }

    interceptPosX = objectPosX + travelTime * objectVelX;
    interceptPosY = objectPosY + travelTime * objectVelY;
    totalDistanceTraveled = travelTime * playerSpeed;

    // Check if the intercept position is within the circle
    if (Math.sqrt(interceptPosX ** 2 + interceptPosY ** 2) <= circleRadius) {
        success = true;
    }

    if ((travelTime == null) | (interceptPosX== null) | ( interceptPosX==null) |
       (totalDistanceTraveled == null) | (success==null)) {
        console.log( 'Null values');
    }

    return [ success, travelTime, interceptPosX, interceptPosY, totalDistanceTraveled ];
}


function timeBeforeLeavingCircle(objectPosX, objectPosY, objectVelocityX, objectVelocityY, circleRadius) {
    // Check if the object is stationary
    if (objectVelocityX === 0 && objectVelocityY === 0) {
        return Infinity; // Object is stationary
    }

    // Calculate the magnitude of the object's velocity vector
    let objectSpeed = Math.sqrt(objectVelocityX ** 2 + objectVelocityY ** 2);

    // Normalizing the velocity vector to get the direction
    let objectDirectionX = objectVelocityX / objectSpeed;
    let objectDirectionY = objectVelocityY / objectSpeed;

    // Vector from circle center to object
    let centerToObjectX = -objectPosX;
    let centerToObjectY = -objectPosY;

    // Projection of centerToObject on objectDirection
    let projectionLength = (centerToObjectX * objectDirectionX) + (centerToObjectY * objectDirectionY);

    // Finding the closest point on the path to the circle center
    let closestPointX = objectPosX + projectionLength * objectDirectionX;
    let closestPointY = objectPosY + projectionLength * objectDirectionY;

    // Distance from the closest point on the path to the circle center
    let distClosestPointToCenter = Math.sqrt(closestPointX ** 2 + closestPointY ** 2);

    if (distClosestPointToCenter > circleRadius) {
        return Infinity; // Object path does not intersect with the circle
    }

    // Using Pythagorean theorem to find the distance from the closest point to the circle edge along the path
    let edgeDistance = Math.sqrt(circleRadius ** 2 - distClosestPointToCenter ** 2);

    // Total distance from the object to the intersection point
    let totalDistance = projectionLength + edgeDistance;

    // Time to reach the circle edge
    let time = totalDistance / objectSpeed;

    if (time < 0) {
        // If time is negative, the object is moving away from the circle
        return Infinity;
    }

    return time;
}

function testCase() {
    // Define constants
    //const maxEvals = 4000;
    //const typePriorityScoring = 2;
    const circleRadius = +1;

    // Set example to test whether code translation worked
    const whExample = 2;

    let playerStartX;
    let playerStartY;
    let playerSpeed;
    let objectPositionsX;
    let objectPositionsY;
    let objectVelocitiesX;
    let objectVelocitiesY; 
    let objectValues;
    let ID;

    if (whExample==2) {
        playerStartX = -0.0736;
        playerStartY = 0.4499;
        playerSpeed = circleRadius / 20;
        objectPositionsX = [-0.1596, 0.4599, -0.6698, -0.3673, -0.3108, 0.4255, -0.1966, 0.1048];
        objectPositionsY = [-0.0291, -0.7825, 0.2647, -0.6842, -0.3624, 0.1991, 0.6960, 0.8982];
        objectVelocitiesX = [0.0013, -0.0103, 0.0021, -0.0166, 0.0108, 0.0057, -0.0163, -0.0014];
        objectVelocitiesY = [0.0166, 0.0131, 0.0165, 0.0009, 0.0127, 0.0157, -0.0033, 0.0166];
        objectValues = [0.1158, 0.6298, 0.0016, 0.5479, 0.0006, 0.1105, 0.2182, 0.0386];
        ID           = [0,      1     , 2     , 3     , 4     , 5     , 6     , 7 ];

        /* Matlab solution
           maxValue: 1.3959
        minDistance: 2.4534
            minTime: 49.0688
  interceptionOrder: [4×1 double]
 interceptLocations: [4×2 double]
valueGoingTowardsObject: [8×1 double]
     interceptTimes: [4×1 double]
     lastPlayerPosX: 0
     lastPlayerPosY: 0
     */
    }

    if (whExample==3) {
        playerStartX = -0.0736;
        playerStartY = 0.4499;
        playerSpeed = circleRadius / 20;
        objectPositionsX = [];
        objectPositionsY = [];
        objectVelocitiesX = [];
        objectVelocitiesY = [];
        objectValues = [];

        /* Matlab solution
               maxValue: 0
            minDistance: 0.4559
                minTime: 9.1176
      interceptionOrder: -1
    valueGoingTowardsObject: 0
     interceptLocations: [0 0]
         interceptTimes: 9.1176
         lastPlayerPosX: 0
         lastPlayerPosY: 0
         */
    }

    if (whExample==4) {
        playerStartX = -0.0736;
        playerStartY = 0.4499;
        playerSpeed = circleRadius / 20;
        objectPositionsX = [  0.4599 ];
        objectPositionsY = [  -0.7825 ];
        objectVelocitiesX = [ -0.0103  ];
        objectVelocitiesY = [ 0.0131 ];
        objectValues = [ 0.6298 ];

        /* Matlab solution
               maxValue: 0.6298
            minDistance: 1.0184
                minTime: 20.3679
      interceptionOrder: [2×1 double]
     interceptLocations: [2×2 double]
    valueGoingTowardsObject: 0.6298
         interceptTimes: [2×1 double]
         lastPlayerPosX: 0
         lastPlayerPosY: 0
         */
    }

    if (whExample==5) {
        playerStartX = -0.0736;
        playerStartY = 0.4499;
        playerSpeed = circleRadius / 20;
        objectPositionsX = [  0.4599, -0.367 ];
        objectPositionsY = [  -0.7825, -0.6842];
        objectVelocitiesX = [ -0.0103, -0.0166 ];
        objectVelocitiesY = [ 0.0131, 0.0009];
        objectValues = [ 0.6298, 0.5479 ];

        /* Matlab solution
               maxValue: 1.1777
            minDistance: 1.9610
                minTime: 39.2204
      interceptionOrder: [3×1 double]
     interceptLocations: [3×2 double]
    valueGoingTowardsObject: [2×1 double]
         interceptTimes: [3×1 double]
         lastPlayerPosX: 0
         lastPlayerPosY: 0
         */
    }

    if (whExample==6) {
        playerStartX = 0.0744002089007483;
        playerStartY = -0.04066554145514491;
        playerSpeed = 0.0038461538461538464;
        objectPositionsX = [-0.6297230939495665, -0.7292316544554527];
        objectPositionsY = [-0.34547084443620757, -0.4043699458467161];
        objectVelocitiesX = [0.0003445251953664351, 0.0021847427293351655];
        objectVelocitiesY = [0.004346682022134775, 0.003800393898141756];
        objectValues = [0.01654784823767841, 0.4958894052542746];

        /*  Matlab solution
            maxValue: 1.1777
            minDistance: 1.9610
            minTime: 39.2204
            interceptionOrder: [3×1 double]
            interceptLocations: [3×2 double]
            valueGoingTowardsObject: [2×1 double]
            interceptTimes: [3×1 double]
            lastPlayerPosX: 0
            lastPlayerPosY: 0
        */
    }
    
    // Test execution time for 1000 calls
    console.time('functionExecutionTime');
    //let sol;    
    //for (let i=0; i<1000; i++) {
        let [ bestSol,allSol ] = planSingleFrame(playerStartX, playerStartY, playerSpeed, objectPositionsX, objectPositionsY, objectVelocitiesX, objectVelocitiesY, objectValues, circleRadius, ID)
        //sol =               planSingleFrame(playerStartX, playerStartY, playerSpeed, objectPositionsX, objectPositionsY, objectVelocitiesX, objectVelocitiesY, objectValues, circleRadius);
    //}
    console.timeEnd('functionExecutionTime');
    console.log(bestSol);
    console.log("test")
}
