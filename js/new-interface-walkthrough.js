/*
game.js

    Author      :   Sheer Karny, Mark Steyvers
    University  :   University of California, Irvine
    Lab         :   Modeling and Decision-Making Lab (MADLAB)


Game Page JS file (metadata and functionality).

This file should contain all variables and functions needed for
the game.
*/

$("#full-game-container").attr("hidden", false);
$("#survey-workload-container").attr("hidden", true);
$("#survey-full-container").attr("hidden", true);
$("#complete-page-content-container").attr("hidden", true);
$("#ai-comparison-container").attr("hidden", true);

// //****************************************** DATA LOGGING **********************************************//

// Importing functions and variables from the FirebasePsych library
// Data logging: Firebase (inherited from the previous study) has been removed.
// The walkthrough is a tutorial and logs nothing.

function getDebugParams(){
    const urlParams = new URLSearchParams(window.location.search);
    let debugBoolean = Boolean(urlParams.get('debug'));
    // console.log(debugBoolean);
    return debugBoolean;
}

function getCollabTypeParams(){
    const urlParams = new URLSearchParams(window.location.search);
    let collabType = parseInt(urlParams.get('collab'), 10);

    // console.log("collabType: ", collabType);

    if (isNaN(collabType)){
        collabType = 1
    }
    
    return collabType
}

function getWalkthroughParams() {
    // Walkthrough mode can be enabled either by a window-level flag set in the
    // walkthrough HTML (preferred) or by the legacy ?walkthrough=1 URL param.
    if (typeof window !== 'undefined' && window.WALKTHROUGH_MODE === true) {
        return true;
    }
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('walkthrough') === '1';
}

// Keep the participant ID in the URL when leaving the walkthrough.
function studyLink(href) {
    try { return window.ExperimentAPI ? window.ExperimentAPI.withParticipant(href) : href; }
    catch (_error) { return href; }
}

function getSessionParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const session = parseInt(urlParams.get('session'), 10);
    if (Number.isNaN(session)) return null;
    return session;
}

var DEBUG  = getDebugParams();      // Always start coding in DEBUG mode
var COLLAB = getCollabTypeParams(); // 0=ignorant; 1=omit; 2=divide; 3=delay
var WALKTHROUGH_MODE = getWalkthroughParams();
var SESSION_ID = getSessionParam();

// console.log("collab: ", COLLAB);
const GAME_TUTORIAL_SEEN_KEY = 'madlabIntroJsTutorialSeen';
let isTutorialRunning = false;



function markTutorialSeen() {
    try {
        window.localStorage.setItem(GAME_TUTORIAL_SEEN_KEY, 'true');
    } catch (error) {
        if (DEBUG) console.warn('Unable to persist tutorial state in localStorage:', error);
    }
}

function getVisibleElement(selector) {
    const element = document.querySelector(selector);
    if (!element) return null;
    if (window.getComputedStyle(element).display === 'none') return null;
    return element;
}

function startGameTutorial() {
    if (WALKTHROUGH_MODE) return;
    if (isTutorialRunning) return;
    if (typeof window.introJs !== 'function') {
        if (DEBUG) console.warn('Intro.js is not available. Check script loading.');
        showCustomAlert('Tutorial failed to load. Please refresh the page and check your internet connection.');
        return;
    }

    const tutorialSteps = [
        {
            element: getVisibleElement('#gameCanvas'),
            intro: 'This is the play field. Choose a target when it is your turn.'
        },
        {
            element: getVisibleElement('#leftPanelButtons'),
            intro: 'Click Start to begin the game. You can pause at any time to reselect your target.'
        },
        {
            element: getVisibleElement('#scoreRuleCard'),
            intro: 'This panel shows score panel info and the robot teammate status.'
        },
        {
            element: getVisibleElement('#historyCard'),
            intro: 'This history panel records your and the AI\'s selections.'
        }
    ].filter(step => !!step.element);

    if (!tutorialSteps.length) {
        showCustomAlert('Tutorial is currently unavailable because the game layout is hidden.');
        return;
    }

    const syncPreviewStateAfterTutorial = () => {
        // If tutorial interrupts preview/start prompt flow, recover to a startable state.
        const isAlertVisible = $('#customAlert').is(':visible');
        if (gamePhase === 'preview' && !hasLoggedStartEvent && !isAlertVisible) {
            isPaused = false;
            setStartButtonActive(true);
        }
    };

    isTutorialRunning = true;
    window.introJs().setOptions({
        steps: tutorialSteps,
        showProgress: true,
        showBullets: false,
        nextLabel: 'Next',
        prevLabel: 'Back',
        doneLabel: 'Finish'
    }).oncomplete(() => {
        isTutorialRunning = false;
        markTutorialSeen();
        syncPreviewStateAfterTutorial();
    }).onexit(() => {
        isTutorialRunning = false;
        markTutorialSeen();
        syncPreviewStateAfterTutorial();
    }).start();
}

function showWalkthroughInstruction(message, elementSelector = null, doneLabel = 'Next', options = {}) {
    if (!(WALKTHROUGH_MODE && typeof window.introJs === 'function')) {
        return showCustomAlert(message, true);
    }
    // === walkthrough-only ===
    // options.autoAdvanceOnClick: when true, hide the Next/Done button and
    // dismiss the overlay automatically as soon as the user clicks the
    // highlighted target element. The element's own click handler still
    // fires normally (we don't preventDefault), so the walkthrough advances
    // through whatever logic that button triggers.
    // === end walkthrough-only ===
    const autoAdvanceOnClick = !!options.autoAdvanceOnClick;
    const clickTargetSelector = options.clickTargetSelector || null;
    return new Promise((resolve) => {
        const targetElement = elementSelector ? getVisibleElement(elementSelector) : null;
        const steps = targetElement ? [{ element: targetElement, intro: message }] : [{ intro: message }];
        const clickTargetElement = clickTargetSelector
            ? (getVisibleElement(clickTargetSelector) || document.querySelector(clickTargetSelector))
            : targetElement;
        const shouldAutoAdvanceOnClick = autoAdvanceOnClick && !!clickTargetElement;
        const introInstance = window.introJs();
        introInstance.setOptions({
            steps,
            showProgress: false,
            showBullets: false,
            showStepNumbers: false,
            exitOnOverlayClick: false,
            keyboardNavigation: false,
            // When auto-advance is on, hide the action buttons entirely; the
            // user advances by clicking the highlighted button instead.
            showButtons: !shouldAutoAdvanceOnClick,
            nextLabel: doneLabel,
            doneLabel
        });

        let alreadyResolved = false;
        const finish = () => {
            if (alreadyResolved) return;
            alreadyResolved = true;
            resolve();
        };

        introInstance.oncomplete(finish);
        introInstance.onexit(finish);

        if (shouldAutoAdvanceOnClick) {
            const clickHandler = function () {
                // Remove our listener first so the user's original handler
                // can run as usual without re-entering this code.
                clickTargetElement.removeEventListener('click', clickHandler, true);
                // Exit intro.js (this triggers onexit -> finish()).
                try { introInstance.exit(); } catch (e) { /* ignore */ }
            };
            // Use capture so we run BEFORE the element's own click handlers,
            // ensuring the overlay is gone before the next walkthrough step
            // tries to render.
            clickTargetElement.addEventListener('click', clickHandler, true);
        }

        introInstance.start();
    });
}

window.startGameTutorial = startGameTutorial;

// WRITE PROLIFIC PARTICIPANT DATA TO DB1

// database write function

//************************************************ ENVIRONMENT INITIALIZATION ********************************************//
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreTextBlock = document.getElementById('scoreTextBlock');
const teamScoreValue = document.getElementById('teamScoreValue');
const yourScoreValue = document.getElementById('yourScoreValue');
const aiScoreValue = document.getElementById('aiScoreValue');
const world = { width: 800, height: 800 };
const center = { x: canvas.width / 2, y: canvas.height / 2 };
let observableRadius = 390; // Radius for positioning objects

let roundSettings = {};

// *********************************************** EXPERIMENTAL PARAMETERS ***********************************************// 

// NOTE: AI MODE FOR EXPERIMENT 1 SHOULD BE === 0 (NO ASSISTANCE)
// NOTE: Start with default parameters --> make changes that are critical between rounds (to remove duplication)

// change game to complete based on 2 minutes of frame counts at 60 fps


// Keep the existing admin defaults; participant games and practice award +3.
const defaultIndividualBonus = new URLSearchParams(window.location.search).get('admin') === 'true' ? 1 : 3;

let settings = {
    maxSeconds: 180,                    // maximum number of seconds per round --> 3 minutes (consider doing 2.5 minutes)
    AIMode:0,                           // MS4: 0=no assistance; 1=always on; 2=adaptive
    AICollab: 0,                        // MS4: 0=ignorant; 1=intentional; 2=cognitive model
    alpha: 0.7,                         // MS8: planner distance discount (matches the main game)
    AIDisplayMode: 1,                   // MS4: 0=show movement path; 1=show where to click; 2=show which targets to intercept
    AIMaxDisplayLength: 3,              // MS4: can be used to truncate the AI path length shown
    visualizeAIPlayer: 1,               // MS5: 0:default; 1=visualize AI player running in background
    visualizeAIPlayerOffline: 1,        // MS5: 0:default; 1=visualize AI player running in background
    AIStabilityThreshold: 1.2,          // MS7: minimum proportional improvement before recommendation changes
    AIadviceThresholdHigh: 0.7,         // MS6: threshold on value to give AI advice in adaptive AI setting
    AIadviceAngleThreshold: 30,         // MS6: angle tolerance for accepting move in adaptive AI setting
    AIframeDelay: 30,                   // Delaying advice so that it doesn't overwhelm the player
    animationSpeedFactor: 0.5,          // Global slow-down factor for movement
    humanBonusPerSquare: defaultIndividualBonus,             // individual bonus per square
    aiBonusPerTriangle: defaultIndividualBonus,              // individual bonus per triangle
    aiConstraint: 'may-harm',           // may-harm | no-harm
    aiObjective: 'self-bonus',          // self-bonus | self-urgency-bonus | team
    aiAwareness: 'oblivious',           // oblivious | coordinating
    spawnProbability:  1.0,
    spawnInterval: 10,
    valueSkew: 2,
    valueLow: 0,
    valueHigh:  1,
    playerSpeed: 3,
    maxTargets: 2,
    speedLow:  1.5,             // lowest end of object speed distribution
    speedHigh: 2.99,               // highest end of object speed distribution
};
// Expose settings to the global scope so that non-module scripts (e.g., AIplannerv1.5.2.js)
// can read the user's UI selections (aiObjective, aiBonusPerTriangle, etc.).
// Without this, ES-module top-level `let` is invisible to other scripts.
if (typeof window !== 'undefined') { window.settings = settings; }


let AICollab1;
let AICollab2;
// let collab1, collab2;   
let collabPlayer1 = 0;
let collabPlayer2 = 1;

let agent1Name;
let agent2Name;

let agentOrder = [];

let agentNames = {
    1: "Selfish",
    2: "Rational",
    c : "Team-first"
    // 0: "Ignorant",
    // 1: "Omit",
    // 2: "Divide",
    // 3: "Delay",
    // 4: "Bottom-Feeder",
    // 5: "Square Hunter"
}

let teamingSettings = {
    1: {AICollab1 : 0,          // ignorant
        AICollab2 : 3},         // delay
        
    2: {AICollab1 : 0,          // ignorant
        AICollab2 : 1},         // omit

    3: {AICollab1 : 0,          // ignorant
        AICollab2 : 4},         // bottom-feeder

    4: {AICollab1 : 0,          // ignorant
        AICollab2 : 2},         // divide

    5: {AICollab1 : 3,          // delay
        AICollab2 : 1},         // omit

    6: {AICollab1 : 3,          // delay
        AICollab2 : 4},         // bottom-feeder

    7: {AICollab1 : 3,          // delay
        AICollab2 : 2},         // divide

    8: {AICollab1 : 1,          // omit
        AICollab2 : 4},         // bottom-feeder

    9: {AICollab1 : 1,          // omit
        AICollab2 : 2},         // divide

    10:{AICollab1 : 4,          // bottom-feeder    
        AICollab2 : 2}          // divide,
};

let difficultySettings = {
    // 5 targets first
    1: {0: {1: {AICollab: collabPlayer1,     // Pair A
                maxTargets: 5},  
            2: {AICollab: collabPlayer2,
                maxTargets: 5}},
        1: {1: {AICollab: collabPlayer1,     // Pair A
                maxTargets: 15},
            2: {AICollab: collabPlayer2,
                maxTargets: 15}}},

    2: {0: {1: {AICollab: collabPlayer2,    // Pair B
                maxTargets: 5},  
            2: {AICollab: collabPlayer1,
                maxTargets: 5}},
        1: {1: {AICollab: collabPlayer1,    // Pair A
                maxTargets: 15},
            2: {AICollab: collabPlayer2,
                maxTargets: 15}}},
    
    3: {0: {1: {AICollab:collabPlayer1,    // Pair A
                maxTargets: 5},
            2: {AICollab: collabPlayer2,
                maxTargets: 5}},
        1: {1: {AICollab: collabPlayer2,   // Pair B
                maxTargets: 15},
            2: {AICollab: collabPlayer1,
                maxTargets: 15}}},

    4: {0: {1: {AICollab: collabPlayer2,    // Pair B
                maxTargets: 5}, 
            2: {AICollab: collabPlayer1,
                maxTargets: 5}},
        1: {1: {AICollab: collabPlayer2,    // Pair B
                maxTargets: 15},
            2: {AICollab: collabPlayer1,
                maxTargets: 15}}},

     // 15 Targets first
    5: {0: {1: {AICollab: collabPlayer1,     // Pair A
                maxTargets: 15},  
            2: {AICollab: collabPlayer2,
                maxTargets: 15}},
        1: {1: {AICollab: collabPlayer1,     // Pair A
                maxTargets: 5},
            2: {AICollab: collabPlayer2,
                maxTargets: 5}}},

    6: {0: {1: {AICollab: collabPlayer2,   // Pair B
                maxTargets: 15},  
            2: {AICollab: collabPlayer1,
                maxTargets: 15}},
        1: {1: {AICollab: collabPlayer1,    // Pair A
                maxTargets: 5},
            2: {AICollab: collabPlayer2,
                maxTargets: 5}}},
    
    7: {0: {1: {AICollab: collabPlayer1,    // Pair A
                maxTargets: 15},
            2: {AICollab: collabPlayer2,
                maxTargets: 15}},
        1: {1: {AICollab: collabPlayer2,   // Pair B
                maxTargets: 5},
            2: {AICollab: collabPlayer1,
                maxTargets: 5}}},

    8: {0: {1: {AICollab: collabPlayer2,    // Pair B
                maxTargets: 15}, 
            2: {AICollab: collabPlayer1,
                maxTargets: 15}},
        1: {1: {AICollab: collabPlayer2,    // Pair B
                maxTargets: 5},
            2: {AICollab: collabPlayer1,
                maxTargets: 5}}},

};

// function assigns the condition's agent types to the difficulty settings
function updateDifficultySettings() {
    let newDifficultySettings = JSON.parse(JSON.stringify(difficultySettings)); // Create a deep copy

    for (let condition in newDifficultySettings) {
        for (let block in newDifficultySettings[condition]) {
            for (let round in newDifficultySettings[condition][block]) {
                if (newDifficultySettings[condition][block][round].AICollab === 0) {
                    newDifficultySettings[condition][block][round].AICollab = teamingSettings[currentTeamingCondition].AICollab1;
                } else if (newDifficultySettings[condition][block][round].AICollab === 1) {
                    newDifficultySettings[condition][block][round].AICollab = teamingSettings[currentTeamingCondition].AICollab2;
                }
            }
        }
    }

    // console.log("Updated DifficultySettings:", newDifficultySettings);
    return newDifficultySettings;
}

async function updateAgentOrdering() {
    // this function should handle the ordering and naming of the agents
    // if you are in the first round of that block, you should assign the correct agent.

     // This is needed to handle coloring of the AI player and naming
     if (currentRound == 1){
        AIplayer.collabOrder = 1;
        agent1Name = agentNames[AIplayer.collabType];
        agentOrder.push(agent1Name);
    } else if (currentRound == 2){
        AIplayer.collabOrder = 2;
        agent2Name = agentNames[AIplayer.collabType];
        agentOrder.push(agent2Name);
    }

    // console.log("Agent 1 & 2 Names", agent1Name, agent2Name);
}

// *********************************************** GAME INITIALIZATION ***********************************************//

function getPermutations(array) {
    // Base case: if array is empty, there is only one permutation: an empty array
    if (array.length === 0) return [[]];

    let permutations = [];

    for (let i = 0; i < array.length; i++) {
        let rest = array.slice(0, i).concat(array.slice(i + 1));
        let restPermutations = getPermutations(rest);

        for (let perm of restPermutations) {
            permutations.push([array[i]].concat(perm));
        }
    }

    return permutations;
}

const seedSet = [12, 123, 1234, 12345, 123456];
const maxTargetSet = [5, 10, 15];
// const perumutedTargets = getPermutations(maxTargetSet);
// console.log(perumutedTargets);

// Block randomization variables -- placed here for ordering dependency
let currentRound = 1;
let currentBlock = 0;
let currentCondition = null;
let currentTeamingCondition = null;
let curSeeds = null;   
let noAssignment = true;

let maxRounds = 2;
let roundID = "round + " + currentRound;

// Timing variables
let gameStartTime, elapsedTime;
let isPaused            = false; // flag for pausing the game
let isStopped           = false; // flag for freezing movement via Stop button
let isGameRunning       = false;
let frameCountGame      = 0; // MS: number of updates of the scene
let deltaFrameCount     = 0; // To limit the size of the Event Stream object; 
const fps               = 30; // Desired logic updates per second
let drtCount            = 0; // frame count for the DRT task for displaying the light
let drtLightChoice      = 0; // random choice of light to display

let maxFrames = null;
if (DEBUG){
    maxFrames         = 60 * fps;// settings.maxSeconds * fps;
} else{ // set it to whatever you want
    maxFrames         = settings.maxSeconds * fps; //120 * 60; // Two minutes in frames
}

// let halfwayGame = Math.floor(maxFrames/2);

const updateInterval    = 1000 / fps; // How many milliseconds per logic update
let firstRender         = 0;
let roundTime           = 0;

// Data collection variables
let objects         = [];
let spawnData       = [];
let caughtTargets   = [];
let missedTargets   = [];
let playerClicks    = [];
let playerLocation  = [];
let aiClicks        = [];
let aiClicks_adjusted       = [];

let aiClicks_offline = [];
let aiClicks_adjusted_offline = [];


// ****** PLAN DELAY VARIABLES ****** //

// Delay for the collaborative agent between plans
let planDelayCounter = 0;
let planDelay = false; 
let planDelayFrames = Math.floor(0.7 * 30); // 700 ms in frames (based on pilot data)

let avgResponseTime;
let clickTimes = [];

// ********************************* //

// const eventStreamSize = 720; // 2 minutes of 60 fps updates
// let eventStream = Array.from({ length: eventStreamSize }, () => ({}));// preallocate the array
let eventStream = [];
let AIeventStream = [];
let AIeventStream_offline = [];

// Variables for cursor
let cursorSize = 40;
let mouseX = 0, mouseY = 0;

// Varaiables for HTML elements
let totalScore = 0;
let score = 0;
let aiScore = 0;
let aiScore_offline = 0;
let numAIChanges = 0; // MS7 count of number of different targets pursued (measure of "neuroticism" or inverse "inertia")
let nextObjectId = 0;
const choiceHistory = [];
const maxChoiceHistory = 100;
let gamePhase = 'preview'; // preview | human_select | ai_select | animate
let selectionQueue = [];
let selectionIndex = 0;
let aiSelectionPlanned = false;
let selectionCycleTrigger = 'start'; // start | intercept | pause | normal
let hasActorSelectedTarget = { Human: false, Bot: false };
let lastSelectedTargetByActor = { Human: null, Bot: null };
let pendingStartHumanSelection = null;
let pendingHumanSelectionForConfirm = null;
let aiAutoPauseTriggered = false;
let pauseCause = null; // null | human_manual | ai_replan
const aiReplanCheckIntervalFrames = 5;
let pendingAIAutoPauseTargetId = null;
const aiLivePauseStabilityThreshold = 1.0;
let animationElapsed = 0;
let lastAnimationTimestamp = null;
let hasShownStartPrompt = false;
let hasLoggedStartEvent = false;
let confirmationInProgress = false;
let pendingAIReselectAfterHuman = null; // { reason: 'same_target'|'simultaneous', oldTargetId, oldObj }
let walkthroughStage = 'disabled';
let walkthroughRequiredTargetId = null;
let walkthroughPostPausePending = false;
let walkthroughPausePromptTimeoutId = null;

function setWalkthroughStage(nextStage) {
    if (!WALKTHROUGH_MODE) return;
    if (nextStage !== 'confirmed_10' && walkthroughPausePromptTimeoutId !== null) {
        window.clearTimeout(walkthroughPausePromptTimeoutId);
        walkthroughPausePromptTimeoutId = null;
    }
    walkthroughStage = nextStage;
}

function scheduleWalkthroughPauseButtonDemo() {
    if (!WALKTHROUGH_MODE) return;
    if (walkthroughPausePromptTimeoutId !== null) {
        window.clearTimeout(walkthroughPausePromptTimeoutId);
        walkthroughPausePromptTimeoutId = null;
    }
    setPauseButtonActive(false);
    walkthroughPausePromptTimeoutId = window.setTimeout(() => {
        walkthroughPausePromptTimeoutId = null;
        if (!(WALKTHROUGH_MODE && walkthroughStage === 'confirmed_10')) {
            return;
        }
        player.moving = false;
        AIplayer.moving = false;
        isStopped = true;
        setPauseButtonActive(true);
        setWalkthroughStage('await_pause_click');
        showWalkthroughInstruction(
            "Note that at any time during the game, you or your AI teammate can request a pause of the game to update the target selections. You can simply click on the \"Pause game\" button to request a pause.<br><br>Try clicking on the \"Pause game\" button.",
            '#stopButton',
            'Next',
            { autoAdvanceOnClick: true }
        );
    }, 2000);
}

function pickClosestInterceptableTargetForWalkthrough() {
    const activeTargets = objects.filter((obj) => obj.active && !obj.intercepted);
    if (!activeTargets.length) return null;

    const playerStartX = player.x - center.x;
    const playerStartY = player.y - center.y;
    const circleRadius = 390;

    let bestInterceptable = null;
    let bestDistanceSq = Infinity;
    let nearestFallback = null;
    let nearestFallbackDistanceSq = Infinity;

    for (let i = 0; i < activeTargets.length; i++) {
        const obj = activeTargets[i];
        const dx = obj.x - player.x;
        const dy = obj.y - player.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < nearestFallbackDistanceSq) {
            nearestFallbackDistanceSq = distSq;
            nearestFallback = obj;
        }

        const objectStartX = obj.x - center.x;
        const objectStartY = obj.y - center.y;
        const objectVelX = obj.vx * obj.speed;
        const objectVelY = obj.vy * obj.speed;
        const [success, travelTime] = attemptInterceptLocal(
            playerStartX,
            playerStartY,
            player.velocity,
            objectStartX,
            objectStartY,
            objectVelX,
            objectVelY,
            circleRadius
        );

        if (success && Number.isFinite(travelTime) && distSq < bestDistanceSq) {
            bestDistanceSq = distSq;
            bestInterceptable = obj;
        }
    }

    return bestInterceptable || nearestFallback;
}

function pickFarInterceptableTargetForWalkthrough(minDistancePx = 220) {
    const activeTargets = objects.filter((obj) => obj.active && !obj.intercepted);
    if (!activeTargets.length) return null;

    const playerStartX = player.x - center.x;
    const playerStartY = player.y - center.y;
    const circleRadius = 390;
    const minDistSq = minDistancePx * minDistancePx;

    let farEnoughBest = null;
    let farEnoughBestDistSq = -1;
    let farthestInterceptable = null;
    let farthestInterceptableDistSq = -1;
    let farthestFallback = null;
    let farthestFallbackDistSq = -1;

    for (let i = 0; i < activeTargets.length; i++) {
        const obj = activeTargets[i];
        const dx = obj.x - player.x;
        const dy = obj.y - player.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > farthestFallbackDistSq) {
            farthestFallbackDistSq = distSq;
            farthestFallback = obj;
        }

        const objectStartX = obj.x - center.x;
        const objectStartY = obj.y - center.y;
        const objectVelX = obj.vx * obj.speed;
        const objectVelY = obj.vy * obj.speed;
        const [success, travelTime] = attemptInterceptLocal(
            playerStartX,
            playerStartY,
            player.velocity,
            objectStartX,
            objectStartY,
            objectVelX,
            objectVelY,
            circleRadius
        );

        if (!success || !Number.isFinite(travelTime)) continue;

        if (distSq > farthestInterceptableDistSq) {
            farthestInterceptableDistSq = distSq;
            farthestInterceptable = obj;
        }

        if (distSq >= minDistSq && distSq > farEnoughBestDistSq) {
            farEnoughBestDistSq = distSq;
            farEnoughBest = obj;
        }
    }

    return farEnoughBest || farthestInterceptable || farthestFallback;
}

function pickWalkthroughAITargetAvoiding(excludedTargetId) {
    const candidates = objects.filter((obj) => obj.active && !obj.intercepted && obj.ID !== excludedTargetId);
    if (!candidates.length) return null;

    const aiStartX = AIplayer.x - center.x;
    const aiStartY = AIplayer.y - center.y;
    const aiSpeed = AIplayer.velocity || AIplayer.speed || 1.5;
    const circleRadius = 390;

    let best = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < candidates.length; i++) {
        const obj = candidates[i];
        const objectStartX = obj.x - center.x;
        const objectStartY = obj.y - center.y;
        const objectVelX = obj.vx * obj.speed;
        const objectVelY = obj.vy * obj.speed;
        const [success, travelTime] = attemptInterceptLocal(
            aiStartX,
            aiStartY,
            aiSpeed,
            objectStartX,
            objectStartY,
            objectVelX,
            objectVelY,
            circleRadius
        );
        if (!success || !Number.isFinite(travelTime)) continue;
        const dx = obj.x - AIplayer.x;
        const dy = obj.y - AIplayer.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = obj;
        }
    }

    return best || candidates[0] || null;
}

// === walkthrough-only: hardcoded AI target IDs ===
// Walkthrough uses a fixed seed (settings.randSeed = 20260410), so target IDs
// are deterministic. We override the AI planner to make the tutorial behavior
// fully predictable for the demo.
const WALKTHROUGH_AI_FIRST_TARGET_ID = 1;   // AI's first selection
const WALKTHROUGH_AI_REPLAN_TARGET_ID = 0;  // AI's updated selection after auto-pause
const WALKTHROUGH_PAUSE_DEMO_TARGET_ID = 7; // Human's next target before pause demo

function pickWalkthroughPauseDemoTarget() {
    const hardcoded = getHardcodedWalkthroughTargetById(
        WALKTHROUGH_PAUSE_DEMO_TARGET_ID,
        player.targetObjID
    );
    if (hardcoded) return hardcoded;
    return pickFarInterceptableTargetForWalkthrough(220);
}

// Returns the live object with the given ID if it's available (active and not
// caught), and is not the human's selected target. Returns null otherwise so
// the caller can fall back to non-deterministic logic.
function getHardcodedWalkthroughTargetById(targetId, excludedId) {
    if (typeof targetId !== 'number') return null;
    return objects.find((obj) =>
        obj && obj.active && !obj.intercepted &&
        obj.ID === targetId && obj.ID !== excludedId
    ) || null;
}

function applyChosenAITargetForWalkthrough(chosenObj) {
    objects.forEach((obj) => {
        obj.AImarked = false;
    });

    if (chosenObj) {
        AIplayer.targetX = chosenObj.x;
        AIplayer.targetY = chosenObj.y;
        AIplayer.ID = chosenObj.ID;
        AIplayer.toCenter = false;
        chosenObj.AImarked = true;
        chosenObj.AIclicked = true;
    } else {
        AIplayer.targetX = center.x;
        AIplayer.targetY = center.y;
        AIplayer.ID = -1;
        AIplayer.toCenter = true;
    }
}

function runWalkthroughPostPauseFinalSteps() {
    walkthroughPostPausePending = false;
    showWalkthroughInstruction("Finally, as you choose your targets over time, remember your goal is to maximize your final score, which is the team's score plus your bonus scores! To help you keep track of who gets bonus points from what targets, in the field, square targets (your bonus) are colored red like your icon, and triangle targets (the AI's bonus) are colored like the AI's icon (in this example, blue).", '#scoreRuleCard', 'Next').then(() => {
        // walkthrough-only: re-enable the Replay tutorial button now that we
        // are at the very last instruction (Step 17). It was kept disabled
        // throughout the walkthrough to prevent accidental clicks.
        const replayTutorialButton = document.getElementById('replayTutorialButton');
        if (replayTutorialButton) {
            replayTutorialButton.disabled = false;
        }
        showWalkthroughInstruction("Congratulations! You've finished this interface walkthrough tutorial! If you have any questions during the game, you can click \"Replay tutorial\" to watch a recorded walkthrough of the interface again.<br><br>Now, click the button below to take the qualification test!", '#replayTutorialButton', 'Proceed to qualification').then(() => {
            window.location.assign(studyLink('qualification.html'));
        });
    });
}

function getObjectById(targetId) {
    if (targetId === null || targetId === undefined) return null;
    return objects.find((obj) => obj.ID === targetId) || null;
}

// Player and View Initialization (related to one another)
const playerSize = 50;
const player = {
    // color:"red", 
    color: 'rgba(255, 0, 0, 0.5)',//'rgba(0, 0, 255, 0.5)',
    x: canvas.width/2 , //center the x,y in the center of the player.
    y: canvas.height/2 ,
    dx: 0,
    dy: 0,
    moving:false,
    toCenter:false,
    shownAdvice:false, //MS6: flag to show advice
    targetX:canvas.width/2,
    targetY:canvas.height/2,
    targetObjID:null,
    velocity: 1.5,
    angle:0,
    speed: 1.5, 
    width:50, 
    height:50,
    score:0
};

let humanImg = new Image();
humanImg.src = '../images/human-head-small.png'; // Path to your robot head image

const camera = {
    x: world.width / 2,
    y: world.height / 2,
    width: canvas.width,
    height: canvas.height
};

// MS: adding a random number generator
function lcg(seed) {
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    let current = seed;
  
    return function() {
      current = (a * current + c) % m;
      return current / m;
    };
}

function generateRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
let randomGenerator;
const START_POSITION_RADIUS = 150;
const DIAGONAL_START_OFFSET = Math.round(START_POSITION_RADIUS / Math.sqrt(2));
const START_POSITION_PRESETS = [
    { id: 'east-west', offset: { x: START_POSITION_RADIUS, y: 0 } },
    { id: 'west-east', offset: { x: -START_POSITION_RADIUS, y: 0 } },
    { id: 'north-south', offset: { x: 0, y: -START_POSITION_RADIUS } },
    { id: 'south-north', offset: { x: 0, y: START_POSITION_RADIUS } },
    { id: 'northeast-southwest', offset: { x: DIAGONAL_START_OFFSET, y: -DIAGONAL_START_OFFSET } },
    { id: 'northwest-southeast', offset: { x: -DIAGONAL_START_OFFSET, y: -DIAGONAL_START_OFFSET } }
];
let lastStartPresetIndex = -1;
let currentStartPreset = null;
const roundStartPresetLog = [];

function chooseStartPresetIndex() {
    const presetCount = START_POSITION_PRESETS.length;
    if (presetCount <= 1) return 0;

    const rand = typeof randomGenerator === 'function' ? randomGenerator() : Math.random();
    let index = Math.floor(rand * presetCount);

    // Avoid repeating the exact same preset in back-to-back rounds.
    if (index === lastStartPresetIndex) {
        index = (index + 1) % presetCount;
    }
    return index;
}

function applySymmetricStartPresetForRound() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const presetIndex = chooseStartPresetIndex();
    const preset = START_POSITION_PRESETS[presetIndex];
    const offset = preset.offset;

    const humanX = centerX + offset.x;
    const humanY = centerY + offset.y;
    const aiX = centerX - offset.x;
    const aiY = centerY - offset.y;

    player.x = humanX;
    player.y = humanY;
    player.targetX = humanX;
    player.targetY = humanY;
    player.moving = false;
    player.toCenter = false;

    AIplayer.x = aiX;
    AIplayer.y = aiY;
    AIplayer.targetX = aiX;
    AIplayer.targetY = aiY;
    AIplayer.moving = false;

    AIplayer_offline.x = aiX;
    AIplayer_offline.y = aiY;
    AIplayer_offline.targetX = aiX;
    AIplayer_offline.targetY = aiY;
    AIplayer_offline.moving = false;

    lastStartPresetIndex = presetIndex;
    currentStartPreset = {
        presetId: preset.id,
        presetIndex,
        block: currentBlock,
        round: currentRound,
        human: { x: humanX, y: humanY },
        ai: { x: aiX, y: aiY }
    };
    roundStartPresetLog.push({
        ...currentStartPreset,
        timestamp: Date.now()
    });

    // Attach to round settings so it can be persisted with round metadata.
    if (roundSettings && typeof roundSettings === 'object') {
        roundSettings.startPositionPresetId = preset.id;
        roundSettings.startPositionPresetIndex = presetIndex;
        roundSettings.startPositions = {
            human: { x: humanX, y: humanY },
            ai: { x: aiX, y: aiY }
        };
    }

    if (DEBUG) {
        console.log('Start position preset selected:', currentStartPreset);
    }
}

// intial varaiables for moving average to delay clicks
let ema;
let period = 10;
let smoothingFactor = 2 / (1 + period);

// MS4: ********************************************** AI PLANNER ****************************************************//

//let sol; // MS7
let firstStep, bestSol, allSol; // MS7  Global variable that holds the solutions of the planner 
let firstStepOffline, bestSolOffline, allSolOffline; // MS7  Global variable that holds the solutions of the planner 
let firstStepCollab, bestSolCollab, allSolCollab; // MS7  Global variable that holds the solutions of the planner for the online collaborative AI

// let sol; // MS4: global variable that contains planned path for current frame

const AIplayerSize = 50;
const AIplayer = {
    color: 'rgba(0, 128, 0, 0.5)',//'rgba(255, 0, 0, 0.5)', 
    x: canvas.width/2 + 150, //center the x,y in the center of the player.
    y: canvas.height/2 + 150,
    moving:false,
    targetX:0,
    targetY:0,
    velocity: 1.5,
    angle:0,
    speed: 1.5, 
    width:50, 
    height:50,
    score:0,
    collabOrder: 0,
    collabType: 0,
};
let AIcaughtTargets = [];
let AIplayerLocation = [];

let robotHeadImg = new Image();
robotHeadImg.src = '../images/simple-robot-250px.png'; // Path to your robot head image

let AIcaughtTargets_offline = [];
let AIplayerLocation_offline = [];

let numFramesPlayernotMoving = 0; // MS6
let numFramesAfterCaughtTarget = 0; // MS6

const AIplayer_offline = {
    color: 'rgba(128, 128, 128, 0.5)',//'rgba(255, 0, 0, 0.5)', // grey color for the offline player
    x: canvas.width/2 + 150, //center the x,y in the center of the player.
    y: canvas.height/2 + 150,
    moving:false,
    targetX:0,
    targetY:0,
    velocity: 1.5,
    angle:0,
    speed: 1.5, 
    width:50, 
    height:50,
    score:0
};

let AIComparisonComplete = false;
let prevSetting;
//**************************************************** BLOCK RANDOMIZATION ******************************************************//

async function initExperimentSettings() {
    const maxCompletionTimeMinutes = 60;

    // const blockOrderCondition = 'blockOrderCondition'; // a string we use to represent the condition name
    const numConditions = 8; // number of conditions
    const numDraws = 1; // number of draws
    // const assignedCondition = await blockRandomization(db1, studyId, blockOrderCondition, numConditions, maxCompletionTimeMinutes, numDraws);
    let assignedCondition;

    if (DEBUG) {
        assignedCondition = [5]; // 3 == ignorant and divide
    }

    // Fallback when assignment service is unavailable.
    const fallbackConditionIndex = Math.max(0, Math.min(numConditions - 1, (COLLAB || 1) - 1));
    const assignedConditionIndex = Array.isArray(assignedCondition) && Number.isFinite(assignedCondition[0])
        ? assignedCondition[0]
        : fallbackConditionIndex;

    if (DEBUG){ 
        currentCondition = COLLAB;
    } else {
        currentCondition = assignedConditionIndex + 1;
    }

    let teamingBlockCondition = 'teamingCondition'; // a string we use to represent the condition name
    const numTeamingConditions = 10; // number of conditions
    let assignedTeamingCondition;

    // if (DEBUG){
    //     // assignedTeamingCondition = await blockRandomization(db1, studyId, teamingBlockCondition, numTeamingConditions, maxCompletionTimeMinutes, numDraws);
    //     assignedTeamingCondition = [4]; // 3 == ignorant and divide
    // } else {
    //     assignedTeamingCondition = await blockRandomization(db1, studyId, teamingBlockCondition, numTeamingConditions, maxCompletionTimeMinutes, numDraws);
    // }

    if (DEBUG) {
        currentTeamingCondition = Math.max(1, Math.min(numTeamingConditions, COLLAB || 1)); // 3 == ignorant and divide
    } else {
        // Fallback so game can proceed even without teaming assignment.
        currentTeamingCondition = Math.max(1, Math.min(numTeamingConditions, COLLAB || 1));
    }

    // currentTeamingCondition = assignedTeamingCondition[0]+1;

    collabPlayer1 = teamingSettings[currentTeamingCondition].AICollab1;
    collabPlayer2 = teamingSettings[currentTeamingCondition].AICollab2;

    difficultySettings = updateDifficultySettings();

    if (DEBUG) console.log("Assigned AI Teams", collabPlayer1, collabPlayer2);

    var randomValues = [];
    for (var i = 0; i < 4; i++) {
        randomValues.push(generateRandomInt(1, 1000000));
    }

    noAssignment = false;

    curSeeds = randomValues;

    if (DEBUG && !currentCondition){
        currentCondition = 1;
    }

    // return [blockOrderCondition, teamingBlockCondition];
}


let blockOrderCondition, teamingBlockCondition;
// Assign a condition to each new participant.
if (noAssignment){
    if (DEBUG){ // adjust value as needed for debuggin default is the same as the main experiment
        await initExperimentSettings();

        console.log('assignedCondition:', currentCondition); // Add this line
        console.log('assignedTeamingCondition:', currentTeamingCondition); // Add this line 
        console.log('assignedSeed:', curSeeds); // Add this line

    } else {
        // Initialize experiment settings directly; legacy array return is removed.
        await initExperimentSettings();
    }
    startGame(currentRound, currentCondition, currentBlock, curSeeds, currentTeamingCondition); // Start the next round
    noAssignment = false;
}


// ****************************************************** UPDATE FUNCTIONS ********************************************************//


// Start Game function
async function startGame(round, condition, block, seeds) {

    currentRound = round; // Start at the specified round, or the current round

    let blockSetting = difficultySettings[condition][block];
    roundSettings = blockSetting[currentRound];
    
    // reassign default settings to the values grabbed from the current
    // settings.AIMode = roundSettings.AIMode;
    // settings.AIStabilityThreshold = roundSettings.AIStabilityThreshold;
    // settings.AICollab = roundSettings.AICollab;
    const constraintSelect = document.getElementById('constraintSelect');
    if (constraintSelect) {
        settings.aiConstraint = constraintSelect.value || settings.aiConstraint;
    }
    const objectiveSelect = document.getElementById('objectiveSelect');
    if (objectiveSelect) {
        settings.aiObjective = objectiveSelect.value || settings.aiObjective;
    }
    const awarenessSelect = document.getElementById('awarenessSelect');
    if (awarenessSelect) {
        settings.aiAwareness = awarenessSelect.value || settings.aiAwareness;
    }
    AIplayer.collabType = settings.AICollab;


    const densityRange = document.getElementById('densityRange');
    if (densityRange) {
        const maxTargets = parseInt(densityRange.value, 10);
        settings.maxTargets = Number.isNaN(maxTargets) ? roundSettings.maxTargets : maxTargets;
    } else {
        settings.maxTargets = roundSettings.maxTargets;
    }
    

    // Debug setting for max targets
    // if (DEBUG) settings.maxTargets=8; // this was to get many targets for debuggin
   
    // Change to the next seed.
    // Walkthrough mode should be deterministic across reloads.
    if (WALKTHROUGH_MODE) {
        settings.randSeed = 20260410;
        // Keep walkthrough visuals consistent with Round 1 bot styling.
        AIplayer.collabOrder = 1;
        await updateAgentOrdering();
    } else if (block == 0) {
        settings.randSeed = seeds[currentRound - 1];
        await updateAgentOrdering();
    } else if (block == 1 ) {
        settings.randSeed = seeds[currentRound + 1];
        if (currentRound == 2) await updateAgentOrdering();
    }

   
    if (currentRound == 1  && settings.maxTargets == 5) AIplayer.color = 'rgba(0, 128, 0, 0.5)'; // green transparent
    if (currentRound == 2 && settings.maxTargets == 5) AIplayer.color = 'rgba(128, 0, 128, 0.5)'; // purple transparent

    // if (settings.AICollab == 0  && settings.maxTargets == 15) AIplayer.color = 'rgba(128, 128, 128, 0.7)'; // iron transparent
    if (currentRound == 1  && settings.maxTargets == 15) AIplayer.color = 'rgba(0, 0, 255, 0.5)'; // blue transparent
    if (currentRound == 2 && settings.maxTargets == 15) AIplayer.color = 'rgba(184, 115, 51, 0.5)'; // copper transparent 

    if (DEBUG){
        //console.log("Default Settings AI Mode", settings.AIMode);
        console.log("Current Collab AI Mode", roundSettings.AICollab);
        console.log("Current Settings", roundSettings);
        console.log("Current Block", currentBlock);
        console.log("Current Round", currentRound);
        console.log("Current Max Targets", settings.maxTargets);
        console.log("Current Seeds: ", settings.randSeed);
    }
    // Initialize with a seed
    randomGenerator = lcg(settings.randSeed);
    // Start the exponential moving average with a fixed response time of 1/3 of a second -- 10 frames
    clickTimes.push(10);
    applySymmetricStartPresetForRound();

    // Reset game canvas visibility
    const gameCanvas = document.getElementById('gameCanvas');
    gameCanvas.style.display = 'block';
    if (scoreTextBlock) {
        scoreTextBlock.style.display = 'block';
    }

    if (!isGameRunning) {
        setupCanvas();
        gameStartTime   = Date.now();
        frameCountGame  = 0;
        isGameRunning   = true;
        if (objects.length === 0) {
            initializeTargets(settings);
        }
        gameLoop();
    }
}

function buildSessionSummaryPayload(sessionId) {
    const shapes = ['square', 'circle', 'triangle'];
    const levels = [1, 2, 3];
    const makeStats = () => {
        const byLevelShape = {};
        const shapeTotals = {};
        const levelTotals = {};
        levels.forEach((level) => {
            levelTotals[level] = { selected: 0, caught: 0 };
            shapes.forEach((shape) => {
                byLevelShape[`${level}-${shape}`] = { selected: 0, caught: 0 };
            });
        });
        shapes.forEach((shape) => {
            shapeTotals[shape] = { selected: 0, caught: 0 };
        });
        return { byLevelShape, shapeTotals, levelTotals };
    };

    const human = makeStats();
    const ai = makeStats();

    const incrementSelected = (stats, level, shape) => {
        const key = `${level}-${shape}`;
        if (!stats.byLevelShape[key]) return;
        stats.byLevelShape[key].selected += 1;
        stats.shapeTotals[shape].selected += 1;
        stats.levelTotals[level].selected += 1;
    };

    const incrementCaught = (stats, level, shape) => {
        const key = `${level}-${shape}`;
        if (!stats.byLevelShape[key]) return;
        stats.byLevelShape[key].caught += 1;
        stats.shapeTotals[shape].caught += 1;
        stats.levelTotals[level].caught += 1;
    };

    choiceHistory.forEach((entry) => {
        if (!entry || !entry.target || entry.target === 'center') return;
        const match = String(entry.target).match(/^(square|circle|triangle)\s+#\d+\s+\(v=(\d+)/i);
        if (!match) return;
        const shape = String(match[1]).toLowerCase();
        const parsedLevel = parseInt(match[2], 10);
        const level = [1, 2, 3].includes(parsedLevel) ? parsedLevel : null;
        if (!level) return;
        const stats = entry.actor === 'Bot' ? ai : human;
        incrementSelected(stats, level, shape);
    });

    eventStream.forEach((ev) => {
        if (!ev || ev.eventType !== 'catch' || !ev.objectData) return;
        const shape = String(ev.objectData.shape || '').toLowerCase();
        const parsedLevel = parseInt(ev.objectData.urgency ?? ev.objectData.value, 10);
        const level = [1, 2, 3].includes(parsedLevel) ? parsedLevel : null;
        if (!level || !shapes.includes(shape)) return;
        incrementCaught(human, level, shape);
    });

    AIeventStream.forEach((ev) => {
        if (!ev || ev.eventType !== 'catch' || !ev.objectData) return;
        const shape = String(ev.objectData.shape || '').toLowerCase();
        const parsedLevel = parseInt(ev.objectData.urgency ?? ev.objectData.value, 10);
        const level = [1, 2, 3].includes(parsedLevel) ? parsedLevel : null;
        if (!level || !shapes.includes(shape)) return;
        incrementCaught(ai, level, shape);
    });

    return {
        session: sessionId,
        teamScore: totalScore,
        humanBonus: player.score,
        aiBonus: AIplayer.score,
        humanFinal: Number(totalScore || 0) + Number(player.score || 0),
        aiFinal: Number(totalScore || 0) + Number(AIplayer.score || 0),
        human,
        ai
    };
}

// End Game function
// Safety net: the walkthrough's normal exit is runWalkthroughPostPauseFinalSteps().
// This only fires if the round timer expires before the scripted tutorial finishes,
// in which case we still send the participant on to the qualification test.
async function endGame() {
    isGameRunning = false;
    window.location.assign(studyLink('qualification.html'));
}

async function resetGame(){
    objects                 = null;
    spawnData               = null;
    caughtTargets           = null;
    playerClicks            = null;
    playerLocation          = null;
    score                   = null;
    player.score            = null;

    aiScore                 = null;
    AIplayer.score          = null
    AIcaughtTargets         = null;
    AIplayerLocation        = null;
    // aiClicks_adjusted       = null;
    aiClicks                = null;
    aiClicks_offline        = null;

    aiScore_offline                 = null;
    AIplayer_offline.score          = null
    AIcaughtTargets_offline         = null;
    // AIplayerLocation_offline       = null;
    // aiClicks_adjusted_offline      = null;

    // then reassign the variables
    eventStream             = [];//Array.from({ length: eventStreamSize }, () => ({}));// preallocate the array
    objects                 = []; // Reset the objects array
    spawnData               = [];
    caughtTargets           = [];
    playerClicks            = [];
    playerLocation          = [];
    score                   = 0;   

    AIeventStream           = [];
    aiScore                 = 0;
    player.score            = 0;
    AIplayer.score          = 0
    totalScore              = 0;
    aiClicks                = [];
    aiClicks_offline        = [];
    AIcaughtTargets         = [];
    AIplayerLocation        = [];

    // AIeventStream_offline           = [];
    aiScore_offline                 = 0;
    AIplayer_offline.score          = 0
    // aiClicks_adjusted_offline       = [];
    AIcaughtTargets_offline         = [];
    // AIplayerLocation_offline        = [];
    
    player.x        = canvas.width/2;
    player.y        = canvas.height/2;
    player.targetX  = canvas.width/2;
    player.targetY  = canvas.height/2;
    player.targetObjID = null;
    player.toCenter = false;
    AIplayer.x = canvas.width/2 + 150; // Reset AI to default before round-specific preset is applied
    AIplayer.y = canvas.height/2;
    AIplayer.targetX = AIplayer.x;
    AIplayer.targetY = AIplayer.y;
    AIplayer_offline.x = AIplayer.x;
    AIplayer_offline.y = AIplayer.y;
    AIplayer_offline.targetX = AIplayer_offline.x;
    AIplayer_offline.targetY = AIplayer_offline.y;
    gamePhase = 'preview';
    selectionQueue = [];
    selectionIndex = 0;
    aiSelectionPlanned = false;
    selectionCycleTrigger = 'start';
    hasActorSelectedTarget = { Human: false, Bot: false };
    lastSelectedTargetByActor = { Human: null, Bot: null };
    pendingStartHumanSelection = null;
    pendingHumanSelectionForConfirm = null;
    aiAutoPauseTriggered = false;
    pauseCause = null;
    pendingAIAutoPauseTargetId = null;
    animationElapsed = 0;
    lastAnimationTimestamp = null;
    hasShownStartPrompt = false;
    hasLoggedStartEvent = false;
    nextObjectId = 0;
    confirmationInProgress = false;
    setPauseButtonActive(false);
    setStartButtonActive(false);
}

function gameLoop(timestamp) {
    if (!isGameRunning) return;

    if (frameCountGame==0){
        firstRender = Date.now();
    }

    if (frameCountGame >= maxFrames) {
        endGame();
        // console.log("Game Over!", frameCountGame);
        return;
    }

    if (gamePhase === 'animate') {
        if (lastAnimationTimestamp == null) {
            lastAnimationTimestamp = timestamp;
        }
        animationElapsed += (timestamp - lastAnimationTimestamp);
        lastAnimationTimestamp = timestamp;
    } else {
        lastAnimationTimestamp = null;
    }
    elapsedTime = animationElapsed;
    roundTime = animationElapsed;

    // console.log('Running game loop at frame count', frameCount);
    // console.log('Time since running:', now - gameStartTime);
    
    // Calculate time since last update
    var deltaTime = timestamp - lastUpdateTime;

    // Check if it's time for the next update
    if (deltaTime >= updateInterval) {
        lastUpdateTime = timestamp - (deltaTime % updateInterval);
        //console.log("Current Obj")
        updateObjects(settings);
         // Update game logic
        // console.log("Game Loop Settings:", settings);
    }
    render(); 
    updateAttentionGlow();

    // Schedule the next frame
    requestAnimationFrame(gameLoop); 
}

// === walkthrough-only state ===
// Forces the playfield border glow on during specific intro.js tutorial steps
// (e.g., the "playfield" step). It is ONLY ever set to true when
// WALKTHROUGH_MODE is active (see the intro.js onafterchange handler below),
// so the main game cannot be affected by this flag.
var walkthroughForceFieldGlow = false;
// === end walkthrough-only state ===

function updateAttentionGlow() {
    const actionCard = document.getElementById('actionCard');
    const gameContainer = document.getElementById('gameContainer');
    const customAlert = document.getElementById('customAlert');
    if (!actionCard || !gameContainer) return;

    const isAlertVisible = !!customAlert && window.getComputedStyle(customAlert).display !== 'none';
    let needsActionPanel = isAlertVisible || gamePhase === 'preview' || gamePhase === 'confirm';
    let needsPlayfield = gamePhase === 'human_select' && !isAlertVisible;

    // === walkthrough-only override ===
    // Defensive double-guard: only honor the override when WALKTHROUGH_MODE is
    // active. In the main game this branch is dead code.
    if (WALKTHROUGH_MODE && walkthroughForceFieldGlow) {
        needsPlayfield = true;
        // During the intro playfield-focused step, glow only the playfield.
        needsActionPanel = false;
    }
    // === end walkthrough-only override ===

    actionCard.classList.toggle('needs-attention', needsActionPanel);
    gameContainer.classList.toggle('needs-attention', needsPlayfield);
}

var lastUpdateTime = 0;
var isLightOn    = false;

// Render function
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
    drawMask(ctx, player);
    drawCenterMarker();                               // Draw the center marker
    ctx.save();
    drawWorldBoundary();                         
    drawPlayer();                                     
    if (settings.visualizeAIPlayer==1) drawAIPlayer();
    // if (settings.visualizeAIPlayerOffline==1) drawAIPlayerOffline();
    displayAIStatus();                                // Display which ai
    if (gamePhase === 'animate') {
        drawAISolution();                             // Draw AI solution of type specified in settings
    }
    drawObjects();
    const shouldShowTargetDirections = gamePhase !== 'animate' || isStopped;
    if (shouldShowTargetDirections) {
        objects.forEach(obj => {
            if (obj.active && !obj.intercepted) {
                drawVelocityVector(obj);
            }
        });
    }
    ctx.restore();
    drawScore();                      
}

// Update game objects
function updateObjects(settings) {
    if (isPaused || isStopped){
        // console.log("Game is paused");
        return;
    } 
    if (frameCountGame == 0 && !hasShownStartPrompt && !WALKTHROUGH_MODE) {
        hasShownStartPrompt = true;
        if (gamePhase === 'preview' && !hasLoggedStartEvent) {
            setStartButtonActive(true);
        }
    }
    if (deltaFrameCount == 10){
        deltaFrameCount = 0;
    }
    
    if (gamePhase === 'animate') {
        frameCountGame++;                       // MS: increment scene update count
        deltaFrameCount++;                      // Limit the amount of data pushes
    }
    
    player.velocity = settings.playerSpeed * settings.animationSpeedFactor;
 
    // Update player position if it is moving (animation only)
    if (gamePhase === 'animate') {
        if (player.moving) {
            // Live pursuit: keep following the currently selected moving target.
            if (!player.toCenter && player.targetObjID !== null) {
                const liveTarget = objects.find(
                    (obj) => obj.ID === player.targetObjID && obj.active && !obj.intercepted
                );
                if (liveTarget) {
                    player.targetX = liveTarget.x;
                    player.targetY = liveTarget.y;
                }
            }

            const deltaX = player.targetX - player.x;
            const deltaY = player.targetY - player.y;
            const distanceToTarget = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distanceToTarget < player.velocity) {
                // Player has arrived at the target location
                player.x = player.targetX;
                player.y = player.targetY;
                player.moving = false;
            } else {
                numFramesPlayernotMoving = 0; // MS6
                player.angle = Math.atan2(deltaY, deltaX);

                let playerDeltaX = player.velocity * Math.cos(player.angle);
                let playerDeltaY = player.velocity * Math.sin(player.angle);

                player.dx = playerDeltaX;
                player.dy = playerDeltaY;

                player.x +=  player.dx;
                player.y +=  player.dy;

                playerLocation.push({frame: frameCountGame, x: player.x, y: player.y});
            }
        } else {
            numFramesPlayernotMoving++; // MS6
            player.dx = 0;
            player.dy = 0;
        }
    } else {
        player.dx = 0;
        player.dy = 0;
    }

    // Prevent player from moving off-screen
    player.x                = Math.max(player.width / 2, Math.min(canvas.width - player.width / 2, player.x));
    player.y                = Math.max(player.height / 2, Math.min(canvas.height - player.height / 2, player.y));
    // Keep player inside the observable circle
    clampToCircle(player, center, observableRadius - player.width / 2);

    // MS5: Update AI player position if it is moving (animation only)
    AIplayer.velocity       = settings.playerSpeed * settings.animationSpeedFactor;
    AIplayer_offline.velocity = settings.playerSpeed * settings.animationSpeedFactor;

    if (gamePhase === 'animate') {
        const deltaX            = AIplayer.targetX - AIplayer.x;
        const deltaY            = AIplayer.targetY - AIplayer.y;
        const distanceToTarget  = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distanceToTarget < AIplayer.velocity) {
            // AI Player has arrived at the target location
            AIplayer.x         = AIplayer.targetX;
            AIplayer.y         = AIplayer.targetY;
            AIplayer.moving    = false;
        } else if (!planDelay) {
            // Move player towards the target
            AIplayer.angle      = Math.atan2(deltaY, deltaX);
            AIplayer.x         += AIplayer.velocity * Math.cos(AIplayer.angle);
            AIplayer.y         += AIplayer.velocity * Math.sin(AIplayer.angle);
            AIplayer.moving     = true;
            AIplayerLocation.push({time: frameCountGame, x: AIplayer.x, y: AIplayer.y});
        }
    } else {
        AIplayer.moving = false;
    }

    if (planDelay) planDelayCounter++;

    if (planDelayCounter >= planDelayFrames){
        planDelay = false;
        planDelayCounter = 0;
    }

    const deltaX_offline              = AIplayer_offline.targetX - AIplayer_offline.x;
    const deltaY_offline              = AIplayer_offline.targetY - AIplayer_offline.y;
    const distanceToTarget_offline    = Math.sqrt(deltaX_offline * deltaX_offline + deltaY_offline * deltaY_offline);

    if (distanceToTarget_offline < AIplayer_offline.velocity) {
        // AI Player has arrived at the target location
        AIplayer_offline.x         = AIplayer_offline.targetX;
        AIplayer_offline.y         = AIplayer_offline.targetY;
        AIplayer_offline.moving    = false;
    } else {
        // Move player towards the target
        AIplayer_offline.angle      = Math.atan2(deltaY_offline, deltaX_offline);
        AIplayer_offline.x         += AIplayer_offline.velocity * Math.cos(AIplayer_offline.angle);
        AIplayer_offline.y         += AIplayer_offline.velocity * Math.sin(AIplayer_offline.angle);
        AIplayer_offline.moving     = true;
        // AIplayerLocation.push({time: frameCountGame, x: AIplayer.x, y: AIplayer.y});
    }

    // MS: and inserted the following code
    if (gamePhase === 'animate' && frameCountGame % settings.spawnInterval === 0) {
        spawnObject(settings);    
    }

    let toRemove = [];
    let caughtAnything = false; // MS6
    let interceptedBy = null;
    let humanInterceptedSelectedId = null;
    let aiInterceptedSelectedId = null;
    let humanCaughtAISelectedTargetOnWay = false;
    let aiCaughtHumanSelectedTargetOnWay = false;
    objects.forEach((obj, index) => {
        if (obj.active) {
            if (gamePhase === 'animate') {
                // obj.x += obj.vx * obj.speed; // Update x position
                // obj.y += obj.vy * obj.speed; // Update y position
                obj.x += obj.dx * settings.animationSpeedFactor; // Update x position with the magnitude vector
                obj.y += obj.dy * settings.animationSpeedFactor; // Update y position
            }
            // console.log("Object Location", obj.x, obj.y);

            // Check if the object is outside the observable area
            let dx                 = obj.x - center.x;
            let dy                 = obj.y - center.y;
            let distanceFromCenter = Math.sqrt(dx * dx + dy * dy) - 10;

            let inRegion = splitGameHalf(obj);
            obj.inPlayerRegion = inRegion;

            if (distanceFromCenter > observableRadius) { // Object leaves observable area (EXIT EVENT)
                // console.log("Object is outside observable area");
                obj.active = false; // Set the object to inactive
                toRemove.push( index );

                // create an event object here
                let gameState = extractGameState(objects);

                // add an event object for catching the target as a human player
                // Values for writing to dataframe
                let objectData      = {ID: obj.ID, value: obj.value,
                                    x: obj.x, y: obj.y,
                                    dx: obj.dx, dy: obj.dy,
                                    vx: obj.vx, vy: obj.vy, speed: obj.speed,
                                    shape: obj.shape, urgency: obj.urgency,
                                    clicked: obj.clicked, AIclicked: obj.AIclicked, 
                                    marked: obj.marked, AImarked: obj.AImarked};

                let playerData      = {x: player.x, y: player.y, speed: player.velocity, 
                                    dx: player.dx, dy: player.dy,
                                    targetX: player.targetX, targetY: player.targetY,
                                    angle: player.angle, moving: player.moving,
                                    score:player.score, AIscore: AIplayer.score};

                let interceptData   = {x: player.targetX, y: player.targetY, time: 0, distance: 0, 
                                        intendedTarget: player.targetObjID, AIintendedTarget: AIplayer.ID};
                let eventType       = 'exit';

                // collapse the 4 object events (spawning, collision, clicking, exiting) into one 1 dataframe
                let eventObject     = {time: frameCountGame, eventType: eventType, 
                                    objectData: objectData, playerData: playerData, 
                                    interceptData: interceptData, gameState: gameState};

                // if (DEBUG) console.log("Exit Event Object", eventObject);
                eventStream.push(eventObject);
            }
            
            // ********************************** Human CAUGHT TARGET ************************************//
            if (gamePhase === 'animate' && !obj.intercepted && checkCollision(player, obj)) {
                // Collision detected
                obj.intercepted   = true; // MS2: added this flag
                caughtAnything    = true;    //MS6
                const isHumanSelectedTarget = (obj.ID === player.targetObjID);
                if (isHumanSelectedTarget && interceptedBy == null) interceptedBy = 'human';
                if (isHumanSelectedTarget) humanInterceptedSelectedId = obj.ID;
                if (isHumanSelectedTarget) {
                    addHistoryMessage(`You successfully caught the selected target ${obj.ID}`, 'Human');
                } else if (player.targetObjID !== null && player.targetObjID !== undefined) {
                    const levelText = `Level-${obj.urgency || obj.value || 1}`;
                    const shapeText = String(obj.shape || 'target').toLowerCase();
                    addHistoryMessage(
                        `You caught target ${obj.ID} (${levelText}, ${shapeText}) on your way to intercept the selected target ${player.targetObjID}`,
                        'Human'
                    );
                }

                // Team score: sum of collected targets' urgency
                totalScore += obj.value;

                // Human individual: count squares collected
                if (obj.shape === "square") {
                    player.score += settings.humanBonusPerSquare;
                }

                if (isHumanSelectedTarget) player.moving = false; // stop player only after catching intended target
                if (
                    !isHumanSelectedTarget &&
                    player.targetObjID !== null &&
                    player.targetObjID !== undefined &&
                    AIplayer.ID !== null &&
                    AIplayer.ID !== undefined &&
                    AIplayer.ID !== -1 &&
                    AIplayer.ID !== -2 &&
                    obj.ID === AIplayer.ID
                ) {
                    humanCaughtAISelectedTargetOnWay = true;
                }
                // *************************** Data Writing *********************************//
                let gameState = extractGameState(objects);
                let objectData      = {ID: obj.ID, value: obj.value,
                                    x: obj.x, y: obj.y,
                                    dx: obj.dx, dy: obj.dy,
                                    vx: obj.vx, vy: obj.vy, speed: obj.speed,
                                    clicked: obj.clicked, AIclicked: obj.AIclicked, 
                                    marked: obj.marked, AImarked: obj.AImarked};

                let playerData      = {x: player.x, y: player.y, speed: player.velocity, 
                                    dx: player.dx, dy: player.dy,
                                    targetX: player.targetX, targetY: player.targetY,
                                    angle: player.angle, moving: player.moving,
                                    score:player.score, AIscore: AIplayer.score};

                let interceptData   = {x: player.targetX, y: player.targetY, time: 0, distance: 0, 
                                        intendedTarget: player.targetObjID, AIintendedTarget: AIplayer.ID};
                let eventType       = 'catch';
                let eventObject     = {time: frameCountGame, eventType: eventType, 
                                    objectData: objectData, playerData: playerData, 
                                    interceptData: interceptData, gameState: gameState};
                let teamScore = 0;

                // if (DEBUG) console.log("Caught Target Event Object", eventObject);

                eventStream.push(eventObject)
            }

             // MS6 Checking times between catching objects for human player
            if (caughtAnything) numFramesAfterCaughtTarget=0; else numFramesAfterCaughtTarget++;

    // ********************************** AI ONLINE CAUGHT TARGET ************************************//

            // if AI player catches a new object
            if (gamePhase === 'animate' && !obj.intercepted && checkCollision(AIplayer, obj)) { // MS5: added a condition
                // Collision detected
                obj.intercepted   = true; // Added this flag to make sure the object despawns after being caught  
                // obj.AIintercepted = true; // MS2: added this flag             
                //console.log("AI Collision detected!");
                const isAISelectedTarget = (obj.ID === AIplayer.ID);
                if (isAISelectedTarget && interceptedBy == null) interceptedBy = 'ai';
                if (isAISelectedTarget) aiInterceptedSelectedId = obj.ID;
                if (!isAISelectedTarget && AIplayer.ID !== -1 && AIplayer.ID !== null && AIplayer.ID !== undefined) {
                    const levelText = `Level-${obj.urgency || obj.value || 1}`;
                    const shapeText = String(obj.shape || 'target').toLowerCase();
                    addHistoryMessage(
                        `The AI caught target ${obj.ID} (${levelText}, ${shapeText}) on their way to intercept the selected target ${AIplayer.ID}`,
                        'Bot'
                    );
                }
                if (isAISelectedTarget) AIplayer.moving = false;
                if (
                    !isAISelectedTarget &&
                    AIplayer.ID !== null &&
                    AIplayer.ID !== undefined &&
                    AIplayer.ID !== -1 &&
                    AIplayer.ID !== -2 &&
                    player.targetObjID !== null &&
                    player.targetObjID !== undefined &&
                    obj.ID === player.targetObjID
                ) {
                    aiCaughtHumanSelectedTargetOnWay = true;
                }
                let caughtObj     = {frame: frameCountGame, target: obj}   
                AIcaughtTargets.push(caughtObj);
                // Team score: sum of collected targets' urgency
                totalScore += obj.value;

                // AI individual: count triangles collected
                if (obj.shape === "triangle") {
                    AIplayer.score += settings.aiBonusPerTriangle;
                }
                                // *************************** Data Writing *********************************//
                let gameState = extractGameState(objects);
                let objectData    = {ID: obj.ID, value: obj.value,
                                    x: obj.x, y: obj.y,
                                    dx: obj.dx, dy: obj.dy,
                                    vx: obj.vx, vy: obj.vy, speed: obj.speed,
                                    shape: obj.shape, urgency: obj.urgency,
                                    clicked: obj.clicked, AIclicked: obj.AIclicked,
                                    marked: obj.marked, AImarked: obj.AImarked};


                let AIplayerData      = {x: AIplayer.x, y: AIplayer.y, speed: AIplayer.velocity, 
                                    targetX: AIplayer.targetX, targetY: AIplayer.targetY,
                                    angle: AIplayer.angle, moving: AIplayer.moving,
                                    score:AIplayer.score};

                let interceptData   = {x: AIplayer.targetX, y: AIplayer.targetY, time: 0, distance: 0, intendedTarget: AIplayer.ID};
                let eventType       = 'catch';
                let eventObject     = {time: frameCountGame, eventType: eventType, 
                                    objectData: objectData, playerData: AIplayerData, 
                                    interceptData: interceptData,gameState: gameState};

                // if (DEBUG) console.log("Caught Target Event Object", eventObject);

                AIeventStream.push(eventObject)
            }

            // ********************************** AI OFFLINE CAUGHT TARGET ************************************//

            if (gamePhase === 'animate' && !obj.AIintercepted && checkCollision(AIplayer_offline, obj)) { // MS5: added a condition
                // Collision detected
                obj.AIintercepted = true; // MS2: added this flag             
                let caughtObj     = {frame: frameCountGame, target: obj}   
                AIcaughtTargets_offline.push(caughtObj);

                const targetScore = obj.value;

                aiScore_offline           += obj.value;
                AIplayer_offline.score    += obj.value;
                if (DEBUG) console.log("AI Offline Score: ", AIplayer_offline.score);
                let aiBonus = 0;

                // No offline team score needed unless you want it
                if (obj.shape === "triangle") {
                    AIplayer_offline.score += 1;
                }

                // *************************** Data Writing *********************************//

                let gameState = extractGameState(objects);
                let objectData      = {ID: obj.ID, value: obj.value,
                                    x: obj.x, y: obj.y,
                                    dx: obj.dx, dy: obj.dy,
                                    vx: obj.vx, vy: obj.vy, speed: obj.speed,
                                    clicked: obj.clicked, AIclicked: obj.AIclicked,
                                    marked: obj.marked, AImarked: obj.AImarked};

                let AIplayerData      = {x: AIplayer_offline.x, y: AIplayer_offline.y, speed: AIplayer_offline.velocity, 
                                    targetX: AIplayer_offline.targetX, targetY: AIplayer_offline.targetY,
                                    angle: AIplayer_offline.angle, moving: AIplayer_offline.moving,
                                    score: AIplayer_offline.score};

                let interceptData   = {x: AIplayer_offline.targetX, y: AIplayer_offline.targetY, time: 0, distance: 0, intendedTarget: AIplayer_offline.ID};
                let eventType       = 'catch';
                let eventObject     = {time: frameCountGame, eventType: eventType, 
                                    objectData: objectData, playerData: AIplayerData, 
                                    interceptData: interceptData, gameState: gameState};

                // if (DEBUG) console.log("Caught Target Event Object", eventObject);

                AIeventStream_offline.push(eventObject)
            }
        }
    });

    // If both agents caught their own selected targets in the same frame,
    // prioritize the human branch so we can request human reselection first.
    if (humanInterceptedSelectedId !== null && aiInterceptedSelectedId !== null) {
        interceptedBy = 'human';
    }

    if (interceptedBy && gamePhase === 'animate') {
        // During the pause demo animation, a 2s timer controls stopping and prompting Pause.
        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_10') {
            return;
        }
        if (aiInterceptedSelectedId !== null && interceptedBy !== 'ai') {
            addHistoryMessage(`The AI successfully caught the selected target ${aiInterceptedSelectedId}`, 'Bot');
        }
        if (humanInterceptedSelectedId !== null && interceptedBy !== 'human') {
            addHistoryMessage(`You successfully caught the selected target ${humanInterceptedSelectedId}`, 'Human');
        }

        if (interceptedBy === 'ai') {
            let aiChosenObj = planAIFirstTargetForConfirmation();
            // Walkthrough: hardcode AI's next selection to the deterministic ID.
            if (WALKTHROUGH_MODE) {
                const hardcodedNext = getHardcodedWalkthroughTargetById(
                    WALKTHROUGH_AI_REPLAN_TARGET_ID,
                    player.targetObjID
                );
                if (hardcodedNext) {
                    aiChosenObj = hardcodedNext;
                    applyChosenAITargetForWalkthrough(hardcodedNext);
                    if (bestSolCollab) { bestSolCollab.ID = hardcodedNext.ID; }
                }
            }
            const caughtTargetId = aiInterceptedSelectedId ?? aiChosenObj?.ID ?? 'their selected target';

            // History: selected target catch message appears immediately.
            addHistoryMessage(`The AI successfully caught the selected target ${caughtTargetId}`, 'Bot');

            const aiCatchMessage = aiChosenObj
                ? `The AI successfully caught their selected <strong>target ${caughtTargetId}</strong>, and it selected ${formatTargetLabelHtml(aiChosenObj)} as its next target.`
                : `The AI successfully caught their selected target ${caughtTargetId}, and it selected no target and will return to center.`;

            player.moving = false;
            AIplayer.moving = false;
            isStopped = true;

            showCustomAlert(aiCatchMessage, true).then(() => {
                // After OK: log AI next-target selection message (next-target wording),
                // then continue animation.
                const previousTrigger = selectionCycleTrigger;
                selectionCycleTrigger = 'intercept';
                addChoiceEntry('Bot', aiChosenObj);
                selectionCycleTrigger = previousTrigger;

                const humanWasChasingAICaughtTarget =
                    player.targetObjID !== null &&
                    player.targetObjID !== undefined &&
                    aiInterceptedSelectedId !== null &&
                    player.targetObjID === aiInterceptedSelectedId;

                if (humanWasChasingAICaughtTarget) {
                    player.moving = false;
                    AIplayer.moving = false;
                    pendingHumanSelectionForConfirm = null;
                    isStopped = false;
                    showCustomAlert('Your selected target is no longer available. Please select another target.').then(() => {
                        startSelectionCycle('human', 'intercept');
                    });
                    return;
                }

                isStopped = false;
                if (player.targetObjID !== null && player.targetObjID !== undefined) {
                    player.moving = true;
                }
                AIplayer.moving = true;
                gamePhase = 'animate';
                setPauseButtonActive(true);
                lastAnimationTimestamp = null;
            });
        } else if (interceptedBy === 'human') {
            player.moving = false;
            AIplayer.moving = false;
            const aiSelectedSameAsHumanCaught =
                humanInterceptedSelectedId !== null &&
                AIplayer.ID !== null &&
                AIplayer.ID !== undefined &&
                AIplayer.ID === humanInterceptedSelectedId;

            if (aiSelectedSameAsHumanCaught) {
                pendingAIReselectAfterHuman = {
                    reason: 'same_target',
                    oldTargetId: AIplayer.ID,
                    oldObj: getObjectById(AIplayer.ID)
                };
            } else if (aiInterceptedSelectedId !== null) {
                pendingAIReselectAfterHuman = {
                    reason: 'simultaneous',
                    oldTargetId: aiInterceptedSelectedId,
                    oldObj: getObjectById(aiInterceptedSelectedId)
                };
            } else {
                pendingAIReselectAfterHuman = null;
            }
            if (WALKTHROUGH_MODE && walkthroughStage === 'await_human_catch_after_first_animation') {
                // Freeze animate-mode guards while walkthrough overlays are shown.
                // Otherwise the stale "selected target unavailable" check can fire
                // before we start the intended next-selection tutorial step.
                gamePhase = 'human_select';
                isStopped = true;
                const caughtMsg = humanInterceptedSelectedId !== null
                    ? `You've successfully caught your selected <strong>target ${humanInterceptedSelectedId}</strong>. Now, select in the field which target you want to catch next.`
                    : "You've successfully caught your selected target. Now, select in the field which target you want to catch next.";
                showWalkthroughInstruction("When both you and the AI have chosen targets, the game will run the animation to automatically move you and the AI along the best paths to catch them. The animation will stop whenever one of you catches the chosen target successfully.", '#gameCanvas', 'Next').then(() => {
                    const pauseDemoTarget = pickWalkthroughPauseDemoTarget();
                    walkthroughRequiredTargetId = pauseDemoTarget ? pauseDemoTarget.ID : null;
                    const step12Message = walkthroughRequiredTargetId !== null
                        ? `In this case, you are the one who just caught your target. In the action panel, you are now asked to select your next target. If it was the AI who caught its target instead, you will see information here about which target the AI selects as its next target (it will also be marked with a cross in the field, in the same color as the AI's icon).<br><br>For this tutorial, choose a target that is sufficiently far away from your current location so you can try the pause function. Click the "OK" button in the action panel and then select <strong>target ${walkthroughRequiredTargetId}</strong> in the field.`
                        : 'In this case, you are the one who just caught your target. In the action panel, you are now asked to select your next target. If it was the AI who caught its target instead, you will see information here about which target the AI selects as its next target (it will also be marked with a cross in the field, in the same color as the AI\'s icon).<br><br>For this tutorial, choose a target that is sufficiently far away from your current location so you can try the pause function. Click the "OK" button in the action panel and then select a far target in the field.';
                    const caughtAlertPromise = showCustomAlert(caughtMsg, true);
                    showWalkthroughInstruction(
                        step12Message,
                        '#actionCard',
                        'Next',
                        { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertOkButton' }
                    );
                    caughtAlertPromise.then(() => {
                        setWalkthroughStage('await_target_10');
                        startSelectionCycle('human', 'intercept');
                    });
                });
            } else {
                const msg = humanInterceptedSelectedId !== null
                    ? `You've successfully caught your selected <strong>target ${humanInterceptedSelectedId}</strong>. Now, select in the field which target you want to catch next.`
                    : "You've successfully caught your selected target. Now, select in the field which target you want to catch next.";
                showCustomAlert(msg, true);
                startSelectionCycle('human', 'intercept');
            }
        }
    }

    // Human caught the AI's selected target while en route to a different selected target.
    if (
        gamePhase === 'animate' &&
        humanCaughtAISelectedTargetOnWay &&
        humanInterceptedSelectedId === null
    ) {
        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_10') {
            return;
        }
        const aiChosenObj = planAIFirstTargetForConfirmation();
        const newLabel = aiChosenObj
            ? formatTargetLabelHtml(aiChosenObj)
            : (AIplayer.ID === -2
                ? '<strong>holding position</strong> (no interceptable target)'
                : 'no target (return to center)');
        player.moving = false;
        AIplayer.moving = false;
        isStopped = true;
        const message = `Since the AI's selected target was caught by you, they updated their target to ${newLabel}.`;
        showCustomAlert(message, true).then(() => {
            const previousTrigger = selectionCycleTrigger;
            selectionCycleTrigger = 'pause';
            if (aiChosenObj) {
                addChoiceEntry('Bot', aiChosenObj);
            } else if (AIplayer.ID === -2) {
                lastSelectedTargetByActor.Bot = -2;
                hasActorSelectedTarget.Bot = true;
                addHistoryMessage(
                    'The AI will hold position (no interceptable target for the next move).',
                    'Bot'
                );
            } else {
                addChoiceEntry('Bot', null);
            }
            selectionCycleTrigger = previousTrigger;
            if (aiCaughtHumanSelectedTargetOnWay) {
                pendingHumanSelectionForConfirm = null;
                showCustomAlert('Your selected target is no longer available. Please select another target.', true).then(() => {
                    isStopped = false;
                    startSelectionCycle('human', 'intercept');
                });
                return;
            }
            isStopped = false;
            resumeMotionAfterConfirmation();
            lastAnimationTimestamp = null;
        });
        return;
    }

    // AI caught the human's selected target while en route to a different selected target.
    if (
        gamePhase === 'animate' &&
        aiCaughtHumanSelectedTargetOnWay &&
        aiInterceptedSelectedId === null &&
        humanInterceptedSelectedId === null &&
        !humanCaughtAISelectedTargetOnWay
    ) {
        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_10') {
            return;
        }
        player.moving = false;
        AIplayer.moving = false;
        isStopped = true;
        pendingHumanSelectionForConfirm = null;
        showCustomAlert('Your selected target is no longer available. Please select another target.', true).then(() => {
            isStopped = false;
            startSelectionCycle('human', 'intercept');
        });
        return;
    }

    // ********************************** ONLY Remove Objects that have EXITED ************************************//

    // MS4: Remove items starting from the end
    for (let i = toRemove.length - 1; i >= 0; i--) {
        objects.splice(toRemove[i], 1);
    }
    if (gamePhase === 'animate') {
        const activeTargets = objects.filter(obj => obj.active && !obj.intercepted).length;
        if (activeTargets === 0) {
            const prevProb = settings.spawnProbability;
            settings.spawnProbability = 1.0;
            spawnObject(settings);
            settings.spawnProbability = prevProb;
        }
    }

    // Human-first strict handling: if the human's selected target becomes unavailable,
    // immediately request reselection.
    if (gamePhase === 'animate' && !isStopped && player.targetObjID !== null && player.targetObjID !== undefined) {
        const humanTargetAlive = objects.some(
            (obj) => obj.ID === player.targetObjID && obj.active && !obj.intercepted
        );
        if (!humanTargetAlive) {
            player.moving = false;
            AIplayer.moving = false;
            pendingHumanSelectionForConfirm = null;
            showCustomAlert('Your selected target is no longer available. Please select another target.');
            startSelectionCycle('human', 'intercept');
            return;
        }
    }

    // Recovery guard: if both agents are idle during animate, force reselection.
    // This can happen when selected targets disappear before interception.
    if (gamePhase === 'animate' && !player.moving && !AIplayer.moving) {
        const humanTargetAlive = objects.some(
            (obj) => obj.ID === player.targetObjID && obj.active && !obj.intercepted
        );
        const aiTargetAlive = objects.some(
            (obj) => obj.ID === AIplayer.ID && obj.active && !obj.intercepted
        );
        // Use this as a rare fallback only when both planned targets are gone.
        if (!humanTargetAlive && !aiTargetAlive) {
            showCustomAlert('Both planned targets are no longer available. Please select your next target.');
            startSelectionCycle('human', 'intercept');
            return;
        }
    }

    // During animation, AI can replan. If a better target appears, pause and reselect.
    if (gamePhase === 'animate' && frameCountGame % aiReplanCheckIntervalFrames === 0) {
        const objectsRemovedLive = getFilteredObjectsForCollabPlanner(objects);
        const prevBestLive = bestSolCollab;
        let firstStepLive;
        let bestSolLive;
        [firstStepLive, bestSolLive] = runAIPlanner(
            objectsRemovedLive,
            AIplayer,
            observableRadius,
            center,
            'collab',
            settings.AIStabilityThreshold,
            prevBestLive,
            frameCountGame,
            settings.alpha
        );

        // Tutorial: AI does not request pause/replan; skip AI pause demo steps.
        if (WALKTHROUGH_MODE) {
            bestSolLive = null;
        }

        // Compare against the last target actually communicated to the user/history,
        // not transient internal IDs, to avoid false "AI paused" triggers.
        const currentAiTargetId = lastSelectedTargetByActor.Bot;
        const hasConcreteCurrentTarget = typeof currentAiTargetId === 'number';
        const aiWouldSwitchTarget =
            hasConcreteCurrentTarget &&
            bestSolLive &&
            bestSolLive.ID !== currentAiTargetId;

        if (!aiWouldSwitchTarget) {
            pendingAIAutoPauseTargetId = null;
        } else if (pendingAIAutoPauseTargetId !== bestSolLive.ID) {
            // Debounce target switching: require the same alternative target twice
            // before triggering AI auto-pause.
            pendingAIAutoPauseTargetId = bestSolLive.ID;
        } else {
            player.moving = false;
            AIplayer.moving = false;
            aiAutoPauseTriggered = true;
            pauseCause = 'ai_replan';
            isStopped = true;
            if (walkthroughPausePromptTimeoutId !== null) {
                window.clearTimeout(walkthroughPausePromptTimeoutId);
                walkthroughPausePromptTimeoutId = null;
            }
            pendingAIAutoPauseTargetId = null;
            addHistoryMessage('The AI paused the game', 'Bot');
            const previousAiTargetObj = getObjectById(currentAiTargetId);
            const proposedObj = objects.find((obj) => obj.ID === bestSolLive.ID) || null;
            const previousLabel = previousAiTargetObj
                ? formatTargetLabelHtml(previousAiTargetObj)
                : formatTargetLabelHtmlFromId(currentAiTargetId);
            const nextLabel = proposedObj
                ? formatTargetLabelHtml(proposedObj)
                : 'no target (return to center)';
            const proposedMsg = `The AI requested a pause of the game, and they updated their target from ${previousLabel} to ${nextLabel}.`;

            // Reflect the AI's updated target immediately in the field during pause.
            if (bestSolLive) {
                AIplayer.targetX = bestSolLive.x;
                AIplayer.targetY = bestSolLive.y;
                AIplayer.ID = bestSolLive.ID;
                AIplayer.toCenter = (AIplayer.ID === -1);
                objects.forEach((obj) => {
                    obj.AImarked = false;
                    obj.AIclicked = false;
                });
                if (proposedObj) {
                    proposedObj.AImarked = true;
                    proposedObj.AIclicked = true;
                }
            }
            if (WALKTHROUGH_MODE && (walkthroughStage === 'await_pause_click' || walkthroughStage === 'confirmed_10')) {
                // walkthrough-only: if AI pauses before the user manually clicks Pause,
                // explicitly explain this edge case with an intro-style
                // walkthrough instruction, then continue to the pause-step
                // instruction.
                const aiPauseExplanation = "In this case, the AI is the one who just paused and updated its target. In the action panel, you will see information about which target the AI selects as its next target.";
                const aiPauseAlertPromise = showCustomAlert(proposedMsg, true);
                const aiPauseInstructionPromise = showWalkthroughInstruction(
                    aiPauseExplanation,
                    '#actionCard',
                    'Next',
                    { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertOkButton' }
                );
                Promise.all([aiPauseAlertPromise, aiPauseInstructionPromise]).then(() => {
                    startSelectionCycle('ai', 'pause');
                    isStopped = false;
                    setWalkthroughStage('await_pause_click');
                    showWalkthroughInstruction(
                        "Note that at any time during the game, you or your AI teammate can request a pause of the game to update the target selections. You can simply click on the \"Pause game\" button to request a pause.<br><br>Try clicking on the \"Pause game\" button.",
                        '#stopButton',
                        'Next',
                        { autoAdvanceOnClick: true }
                    );
                });
            } else {
                showCustomAlert(proposedMsg, true).then(() => {
                    startSelectionCycle('ai', 'pause');
                    isStopped = false;
                });
            }
            return;
        }
    }

    // **************************************** Run the Collab AI Planner ****************************************//
    if (gamePhase !== 'ai_select') return;
    if (aiSelectionPlanned) return;
    
    // Collab player
    let prevBestSolCollab = bestSolCollab;
    let prevFirstStepCollab = firstStepCollab;

    let objectsRemoved = getFilteredObjectsForCollabPlanner(objects);
    // Clear previous AI marks before selecting new target
    objects.forEach((obj) => {
        obj.AImarked = false;
    });

    // No more bottom-feeder in the new policy set

    
    // SK1 Online AI player
    [ firstStepCollab, bestSolCollab ] = runAIPlanner(objectsRemoved, AIplayer , observableRadius , center, 'collab', 
            settings.AIStabilityThreshold, prevBestSolCollab, frameCountGame, settings.alpha );
    
    // AI intention for click,target pair
    AIplayer.targetX = firstStepCollab.x; // MS7 -- just save the firstStepOffline object to firebase
    AIplayer.targetY = firstStepCollab.y; 
    AIplayer.ID      = firstStepCollab.ID; // MS8 // ID of the object to intercept

    if (AIplayer.ID == -1){
        AIplayer.toCenter = true; 
    } else{
        AIplayer.toCenter = false;
    }

    // Mark the object as currently being targeted (clear others first)
    objects.forEach((obj) => {
        obj.AImarked = false;
    });
    if (AIplayer.ID !== -1) {
        const chosenObj = objects.find(obj => obj.ID === AIplayer.ID);
        if (chosenObj) {
            chosenObj.AImarked = true;
            chosenObj.AIclicked = true;
        }
    }
    if (AIplayer.ID === -1) {
        addChoiceEntry('Bot', null);
    } else {
        const chosenObj = objects.find(obj => obj.ID === AIplayer.ID);
        if (chosenObj) addChoiceEntry('Bot', chosenObj);
    }
    // Keep track of collab agent decisions
    const aiChangedTarget =
        (prevFirstStepCollab != null) &&
        (prevBestSolCollab != null) &&
        (bestSolCollab.ID != prevBestSolCollab.ID);

    if (aiChangedTarget) {
        // push AI intention array
        let aiIntention = {frame: frameCountGame, x: AIplayer.targetX, y: AIplayer.targetY, id: bestSolCollab.ID, planDelay: planDelay};
        aiClicks.push(aiIntention);
        numAIChanges++;
        // Only log AI pause when this reselection cycle itself was triggered by a pause action,
        // not by successful interception/reselection.
        if (selectionCycleTrigger === 'pause' && !aiAutoPauseTriggered && pauseCause === 'ai_replan') {
            addHistoryMessage('The AI paused the game', 'Bot');
        }
    } else if (prevBestSolCollab == null) {
        let aiIntention = {frame: frameCountGame, x: AIplayer.targetX, y: AIplayer.targetY, id: bestSolCollab.ID};
        aiClicks.push(aiIntention);
    }

    aiAutoPauseTriggered = false;
    aiSelectionPlanned = true;
    advanceSelection();

    // **************************************** Run the Offline AI Planner ****************************************//

    let prevBestSolOffline = bestSolOffline;
    let prevFirstStepOffline = firstStepOffline;

    [ firstStepOffline, bestSolOffline ] = runAIPlanner(objects, AIplayer_offline , observableRadius , center, 'AI', 
        settings.AIStabilityThreshold, prevBestSolOffline, frameCountGame, settings.alpha, false );
    
    AIplayer_offline.targetX = firstStepOffline.x; // MS7 -- just save the firstStepOffline object to firebase
    AIplayer_offline.targetY = firstStepOffline.y; 
    AIplayer_offline.ID      = firstStepOffline.ID; // MS8 // ID of the object to intercept

    // we need to save the decisions from the offline agent
    if ((prevFirstStepOffline != null) && (bestSolOffline.ID != prevBestSolOffline.ID)) { // all other decisions
        let aiIntention_offline = {frame: frameCountGame, x: AIplayer_offline.targetX, y: AIplayer_offline.targetY, id: bestSolOffline.ID};
        aiClicks_offline.push(aiIntention_offline);
        numAIChanges++;
    } else if (prevBestSolCollab == null) { // first decision
        let aiIntention_offline = {frame: frameCountGame, x: AIplayer_offline.targetX, y: AIplayer_offline.targetY, id: bestSolOffline.ID};
        aiClicks_offline.push(aiIntention_offline);
        numAIChanges++;
    }

     // ************************************* Run the Human Assistive AI Planner ***********************************//
    // Run the planner conditional on the human player
    // MS8
    // Disabled: predicting the human's selection is not part of the current study, and its
    // result only fed the advice overlay (settings.AIMode is 0). The call also passed its
    // arguments shifted by one (alpha landed in prevBestSol), so its plan was never valid.
    // [ firstStep, bestSol ] = runAIPlanner( objects, player , observableRadius , center, 'human', frameCountGame, settings.alpha, false );
}

function spawnObject(settings){
    // Use active targets to enforce simultaneous density.
    const activeTargetCount = objects.filter(obj => obj.active && !obj.intercepted).length;
    
    let randomThreshold = randomGenerator();
    if (randomThreshold < settings.spawnProbability && activeTargetCount < settings.maxTargets) { // Spawn a new object
        let newObject = createComposite(settings);
        
        // MS: Generate a random angle between 0 and 2π (0 and 360 degrees)
        let angle = randomGenerator() * 2 * Math.PI;

        // get x,y coordinates
        let curXLoc = center.x + observableRadius * Math.cos(angle); // - obj.width / 2;
        let curYLoc = center.y + observableRadius * Math.sin(angle); // - obj.height / 2;

        let location = {x:curXLoc, y:curYLoc, angle:angle, lastSpawnTime:0};

        newObject.x = location.x ;
        newObject.y = location.y ;
        newObject.spawnX = location.x;
        newObject.spawnY = location.y;

        setVelocityTowardsObservableArea(newObject);

        // push to objects array in order to render and update
        objects.push(newObject);
        spawnData.push(newObject);
      
        // ************************* Event Object for Spawning ******************** //   
        let gameState = extractGameState(objects);
        let objectData      = {ID: newObject.ID, value: newObject.value,
                            x: newObject.x, y: newObject.y,
                            dx: newObject.dx, dy: newObject.dy,
                            vx: newObject.vx, vy: newObject.vy, speed: newObject.speed,
                            clicked: newObject.clicked, AIclicked: newObject.AIclicked,
                            marked: newObject.marked, AImarked: newObject.AImarked};

        let playerData      = {x: player.x, y: player.y, speed: player.velocity, 
                            dx: player.dx, dy: player.dy,
                            targetX: player.targetX, targetY: player.targetY,
                            angle: player.angle, moving: player.moving,
                            score:player.score, AIscore: AIplayer.score};

        let interceptData   = {x: player.targetX, y: player.targetY, time: 0, distance: 0, 
                                intendedTarget: player.targetObjID, AIintendedTarget: AIplayer.ID};
     
        let eventType       = 'spawn';

        let eventObject     = {time: frameCountGame, eventType: eventType, 
                            objectData: objectData, playerData: playerData, 
                            interceptData: interceptData, gameState: gameState};

        eventStream.push(eventObject)

    }
    location.lastSpawnTime = elapsedTime;
}

function initializeTargets(settings) {
    const minRadius = observableRadius * 0.2;
    const maxRadius = observableRadius * 0.9;
    const minDistance = 70;
    const count = settings.maxTargets;
    const placed = [];

    const samplePosition = () => {
        const angle = randomGenerator() * 2 * Math.PI;
        const radius = Math.sqrt(randomGenerator() * (maxRadius * maxRadius - minRadius * minRadius) + minRadius * minRadius);
        return {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        };
    };

    for (let i = 0; i < count; i++) {
        let newObject = createComposite(settings);
        let candidate = null;
        let accepted = false;
        for (let tries = 0; tries < 60; tries++) {
            candidate = samplePosition();
            const isFarEnough = placed.every(p => {
                const dx = candidate.x - p.x;
                const dy = candidate.y - p.y;
                return Math.sqrt(dx * dx + dy * dy) >= minDistance;
            });
            if (isFarEnough) {
                accepted = true;
                break;
            }
        }
        if (!accepted) candidate = samplePosition();

        newObject.x = candidate.x;
        newObject.y = candidate.y;
        newObject.spawnX = candidate.x;
        newObject.spawnY = candidate.y;
        placed.push(candidate);

        setVelocityTowardsObservableArea(newObject);

        objects.push(newObject);
        spawnData.push(newObject);
    }
}

function createComposite(settings) {
    if (!settings) {
        console.error("Settings not provided to createComposite");
        return; // Or set default values for settings
    }
    // let shapeType = 'circle';
    const shapeOptions = ['circle', 'square', 'triangle'];
    const shapeIndex   = Math.floor(randomGenerator() * shapeOptions.length);
    let shapeType      = shapeOptions[shapeIndex];

    const shapeSize = 15;
    // minSize + Math.random() * (maxSize - minSize); // Random size within range

    // Sample u ~ Uniform(0,1)
    // adjust u by the skewFloor and skewCeiling
    var valueLow = settings.valueLow;
    var valueHigh = settings.valueHigh;
    var range = valueHigh - valueLow;
    const urgencyBins = 16;
    const urgencyAlpha = 1;
    const urgencyBeta = 2;

    // use the a-b distribution to get a fillRadius
    let probabilities   = binProbabilities(urgencyAlpha, urgencyBeta, urgencyBins);
    let cumulative      = cumulativeProbabilities(probabilities);
    let fillRadiusRaw      = parseInt(sampleFromDistribution(cumulative, 1));
    let minFillRadius   = 2;      // you can try 2 or 3 if 1 is still too tiny
    let fillRadius      = Math.max(minFillRadius, fillRadiusRaw);
    let urgencyLevel;
    if (fillRadius < urgencyBins / 3) {
        urgencyLevel = 1; // low urgency - long lifetime
    } else if (fillRadius < 2 * urgencyBins / 3) {
        urgencyLevel = 2; //medium lifetime
    } else {
        urgencyLevel = 3; // high urgency - short lifetime
    }
    // Quantize inner yellow size to exactly three levels
    const fillLevels = {
        1: 4,
        2: 7,
        3: 10
    };
    fillRadius = fillLevels[urgencyLevel];
    // sample from a distribution of speeds
    let speedRange  = settings.speedHigh - settings.speedLow
   // Higher urgency → faster → shorter lifetime in the circle
    let baseFraction = (urgencyLevel - 1) / 2;   // 0, 0.5, 1 for levels 1,2,3
    let jitter = (randomGenerator() - 0.5) * 0.15; 
    let speedFraction = Math.min(1, Math.max(0, baseFraction + jitter));

    let speedSample = settings.speedLow + speedFraction * speedRange;

    let newObj = {
        ID: nextObjectId++,
        type: 'composite',
        speed: speedSample, //(),
        x: 0,
        y: 0,
        vx: 0,              // unit vector not yet scaled by speed
        vy: 0,
        dx: 0,              // vector scaled by speed
        dy: 0,
        velAngle: 0,        // initial velocity angle is zero --> reset in the setVelocityTowardsObservableArea
        size: shapeSize,
        outerColor: 'rgba(97, 87, 87, 0.51)',
        innerColor:  'orange', 
        shape: shapeType, // Add shape type here
        type: 'target',
        fill: fillRadius,
        urgency: urgencyLevel,       // NEW: 1/2/3
        value: urgencyLevel, 
        // value: Math.floor(fillRadius),
        active: true,
        intercepted: false, // MS2: Added this flag
        AIintercepted: false, // MS5: Added this flag
        spawnX: 0,
        spawnY: 0,
        clicked: false,
        AIclicked: false,
        marked: false,
        AImarked: false,
    };
    // console.log(newObj.speed);
 
    return newObj;
}


function setVelocityTowardsObservableArea(obj) {
    // Calculate angle towards the center
    let angleToCenter = Math.atan2(center.y - obj.y, center.x - obj.x);

    // Define the cone's range (22.5 degrees in radians)
    let coneAngle = 90 * (Math.PI / 180); // Convert degrees to radians

    // Randomly choose an angle within the cone
    let randomAngleWithinCone = angleToCenter - coneAngle / 2 + randomGenerator()  * coneAngle;

    // Set velocity based on the angle within the cone
    obj.vx = Math.cos(randomAngleWithinCone);
    obj.vy = Math.sin(randomAngleWithinCone);

    obj.dx = obj.vx * obj.speed;
    obj.dy = obj.vy * obj.speed;
}

// Helper function to determine if an object is within view ***currently not used***


function checkCollision(player, obj) {
    // Calculate the player's bounding box edges from its center
    let playerLeft = player.x - player.width / 2;
    let playerRight = player.x + player.width / 2;
    let playerTop = player.y - player.height / 2;
    let playerBottom = player.y + player.height / 2;

    // Calculate the distance from the center of the player to the center of the object
    let circleDistanceX = Math.abs(obj.x - player.x);
    let circleDistanceY = Math.abs(obj.y - player.y);

    // Check for collision
    if (circleDistanceX > (player.width / 2 + obj.size / 2)) { return false; }
    if (circleDistanceY > (player.height / 2 + obj.size / 2)) { return false; }

    if (circleDistanceX <= (player.width / 2)) { return true; } 
    if (circleDistanceY <= (player.height / 2)) { return true; }

    // Check corner collision
    let cornerDistance_sq = (circleDistanceX - player.width / 2) ** 2 + (circleDistanceY - player.height / 2) ** 2;

    return (cornerDistance_sq <= ((obj.size / 2) ** 2));
}

// Grabs all relevant current game state modeling data
function extractGameState(objects){
    return objects.map(obj => ({
        id: obj.ID,
        x: obj.x,
        y: obj.y,
        vx: obj.vx,
        vy: obj.vy,
        dx: obj.dx,
        dy: obj.dy,
        // magnitude of hte vecto
        speed: obj.speed,
        clicked: obj.clicked,
        marked:obj.marked,
        AImarked:obj.AImarked,
        value: obj.value,
        active: obj.active,
        intercepted: obj.intercepted,
    }));
}

function getExponentialMovingAverage(n) {
    let lastNClicks = clickTimes.slice(Math.max(clickTimes.length - n, 0)); // Get the last n clicks
    lastNClicks.forEach(currentDataPoint => {
        if (ema === undefined) {
            ema = currentDataPoint; // For the first data point, EMA equals the current data point
        } else {
            ema = (currentDataPoint - ema) * smoothingFactor + ema;
        }
    });
    return ema;
}

//***************************************************** BETA SAMPLING ****************************************************//
function gamma(z) {
    const g = 7;
    const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let x = C[0];
    for (let i = 1; i < g + 2; i++)
        x += C[i] / (z + i);
    let t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
// Beta function using the Gamma function
function beta(alpha, beta) {
    return gamma(alpha) * gamma(beta) / gamma(alpha + beta);
}
// Beta distribution PDF
function betaPDF(x, alpha, betaParam) {
    if (x < 0 || x > 1) return 0;
    return (Math.pow(x, alpha - 1) * Math.pow(1 - x, betaParam - 1)) / beta(alpha, betaParam);
}
// Function to calculate the probability of each bin
function binProbabilities(alpha, beta, bins) {
    let step = 1 / bins;
    let probabilities = [];
    for (let i = 0; i < bins; i++) {
        let lower = i * step;
        let upper = (i + 1) * step;
        probabilities.push(integrate(betaPDF, lower, upper, alpha, beta, 1000));
    }
    return probabilities;
}
// Numerical integration using the trapezoidal rule
function integrate(func, start, end, alpha, beta, numSteps) {
    let total = 0;
    let step = (end - start) / numSteps;
    for (let i = 0; i < numSteps; i++) {
        let x0 = start + i * step;
        let x1 = start + (i + 1) * step;
        total += 0.5 * (func(x0, alpha, beta) + func(x1, alpha, beta)) * step;
    }
    return total;
}

// Function to calculate cumulative probabilities
function cumulativeProbabilities(probabilities) {
    let cumulative = [];
    let sum = 0;
    for (let prob of probabilities) {
        sum += prob;
        cumulative.push(sum);
    }
    return cumulative;
}

// Function to sample from the distribution
function sampleFromDistribution(cumulative, totalSamples = 1) {
    let samples = [];
    for (let i = 0; i < totalSamples; i++) {
        let random = randomGenerator();  // generate a random number between 0 and 1
        let index = cumulative.findIndex(cum => cum >= random);
        samples.push(index);
    }
    return samples;
}
//*************************************************** DRAWING FUNCTIONS **************************************************//

function setupCanvas() {
    // Fill the background of the entire canvas with grey
    ctx.fillStyle = 'grey';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  
    // Define the game world area with a white rectangle (or any other color your game uses)
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, world.width, world.height);

    ctx.font = '20px Arial'; // MS4: Font size and style for the text
}

function drawWorldBoundary() {
    ctx.strokeStyle = 'grey';
    ctx.strokeRect(0, 0, world.width, world.height);
}

function drawPlayer() {
    let topLeftX = player.x - player.width / 2;
    let topLeftY = player.y - player.height / 2;

    ctx.fillStyle = player.color;
    ctx.fillRect(topLeftX, topLeftY, player.width, player.height);

    ctx.drawImage(humanImg, topLeftX, topLeftY, 50, 50);
}

// MS5
function drawAIPlayer() {
    let topLeftX = AIplayer.x - AIplayer.width / 2;
    let topLeftY = AIplayer.y - AIplayer.height / 2;

    ctx.fillStyle = AIplayer.color;
    //ctx.strokeStyle = player.color;
    ctx.fillRect(topLeftX, topLeftY, player.width, player.height);

    ctx.drawImage(robotHeadImg, topLeftX, topLeftY, 50, 50);

    // write the current intended target id to the top left of the player
    // ctx.fillStyle = 'black';
    // ctx.fillText(AIplayer.ID, topLeftX, topLeftY - 5);  
}

function drawAIPlayerOffline() {
    let topLeftX = AIplayer_offline.x - AIplayer_offline.width / 2;
    let topLeftY = AIplayer_offline.y - AIplayer_offline.height / 2;

    ctx.fillStyle = AIplayer_offline.color;
    //ctx.strokeStyle = player.color;
    ctx.fillRect(topLeftX, topLeftY, player.width, player.height);

    // write the current intended target id ot hte top left of hte palyer
    // ctx.fillStyle = 'black';
    // ctx.fillText(AIplayer.ID, topLeftX, topLeftY - 5);  
}

// Function to draw objects
function drawObjects() {
    objects.forEach(obj => {
        if (obj.active) {
            if (!obj.intercepted) drawCompositeShape(obj); // MS2: added this condition
            // if (!obj.AIintercepted) drawCompositeShape(obj); // MS5: added this condition
            // MS5: added this; can be removed once code is tested
            // if ((obj.AIintercepted) && (settings.visualizeAIPlayer==1)) drawCompositeShapeAI(obj);//drawCompositeShapeAI(obj); 
            // if (obj.intercepted) drawCompositeShapeDEBUG(obj); // MS2: added this; can be removed once code is tested
            // //drawDebugBounds(obj);
        }
    });
}

function drawCompositeShape(obj) {
    // If the object is clicked, draw a green highlight around it.
    if (obj.marked && obj.AImarked){
        let offset = true;
        if (!player.toCenter){
            let type = 'player';
            drawTargetMarker(obj.x, obj.y, obj.size + 2, obj.size + 12, 10, type);
        } else{
            offset = false;
        }

        let type = 'AI';
        if (offset && !planDelay){
            drawTargetMarker(obj.x, obj.y, obj.size + 2, obj.size + 12, 10, type, Math.PI/4);
        } else if (!planDelay) {
            drawTargetMarker(obj.x, obj.y, obj.size + 2, obj.size + 12, 10, type);
        }
    }

    if (obj.AImarked && !obj.marked && !planDelay){
        let type = 'AI';
        drawTargetMarker(obj.x, obj.y, obj.size + 2, obj.size + 12, 10, type, Math.PI/4);
    } 

    if (obj.marked && !obj.AImarked && !player.toCenter){
        let type = 'player';
        drawTargetMarker(obj.x, obj.y, obj.size + 2, obj.size + 12, 10, type);
    }


    // if (DEBUG) drawDebugID(obj);   

    // Draw the outer circle first
    // drawCircle(obj.x, obj.y, obj.size, obj.outerColor); // Outer circle

    // // Then draw the inner circle on top
    // drawCircle(obj.x, obj.y, obj.fill, obj.innerColor); // Inner circle, smaller radius
    switch (obj.shape) {
        case 'square':
            // outer
            drawSquare(obj.x, obj.y, obj.size, obj.outerColor);
            // inner (like the “fill” for circles)
            drawSquare(obj.x, obj.y, obj.fill, player.color);
            break;

        case 'triangle':
            drawTriangle(obj.x, obj.y, obj.size, obj.outerColor);
            drawTriangle(obj.x, obj.y, obj.fill, AIplayer.color);
            break;

        case 'circle':
        default:
            drawCircle(obj.x, obj.y, obj.size, obj.outerColor);
            drawCircle(obj.x, obj.y, obj.fill, obj.innerColor);
            break;
    }

    drawTargetNumber(obj);

    // this function shows which objects the player will collide with in the future
    
}

function drawTargetNumber(obj) {
    ctx.save();
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 3;
    const label = String(obj.ID);
    const y = obj.y - obj.size - 6;
    ctx.strokeText(label, obj.x, y);
    ctx.fillStyle = 'black';
    ctx.fillText(label, obj.x, y);
    ctx.restore();
}

function drawCircle(centerX, centerY, radius, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawSquare(centerX, centerY, halfSize, color) {
    ctx.save();
    ctx.beginPath();
    // Treat halfSize similar to radius: it’s half the side length
    ctx.rect(
        centerX - halfSize,
        centerY - halfSize,
        halfSize * 2,
        halfSize * 2
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawTriangle(centerX, centerY, size, color) {
    ctx.save();
    ctx.beginPath();
    // Scale triangle radius so visual width matches circle/square drawn with the same size.
    const visualSize = size * (2 / Math.sqrt(3));
    // Draw an upright equilateral triangle centered on (centerX, centerY)
    const startAngle = -Math.PI / 2; // top vertex
    for (let i = 0; i < 3; i++) {
        const angle = startAngle + i * (2 * Math.PI / 3);
        const x = centerX + visualSize * Math.cos(angle);
        const y = centerY + visualSize * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}





function drawCenterMarker(centerX=400, centerY=400, radius=10, color = "rgba(128, 128, 128, 0.5)"){
    if (player.toCenter) drawCircle(centerX, centerY, 
                                    radius + 5,'red');
    if (AIplayer.toCenter && !planDelay) drawCircle(centerX, centerY,
                                    radius + 5, AIplayer.color);
    // Gray center dot removed from the playfield.
    // drawCircle(centerX, centerY, radius, color);
}

function drawTargetMarker(centerX, centerY, radius1, radius2, triangleBase = 5, type, offset =0) {
    const context = document.querySelector('canvas').getContext('2d'); // Assuming there's a canvas element in your HTML
    const angles = [0 + offset, Math.PI / 2 + offset, Math.PI + offset, (3 * Math.PI) / 2 + offset]; // angles for the 4 triangles

    context.save();
    if (type == 'player') ctx.fillStyle = 'red';

    // AI Players have their own marker colors by the game condition
    if ((type == 'AI') && AIplayer.collabOrder == 1 && settings.maxTargets == 5) ctx.fillStyle = 'green';
    if ((type == 'AI') && AIplayer.collabOrder == 2 && settings.maxTargets == 5) ctx.fillStyle = 'purple';
    if ((type == 'AI') && AIplayer.collabOrder == 1 && settings.maxTargets == 15) ctx.fillStyle = 'blue';
    if ((type == 'AI') && AIplayer.collabOrder == 2 && settings.maxTargets == 15) ctx.fillStyle = 'rgba(176, 97, 23)'; // copper

    angles.forEach((angle) => {
        const tipX = centerX + radius1 * Math.cos(angle);
        const tipY = centerY + radius1 * Math.sin(angle);
        const baseX1 = centerX + radius2 * Math.cos(angle) - triangleBase / 2 * Math.sin(angle);
        const baseY1 = centerY + radius2 * Math.sin(angle) + triangleBase / 2 * Math.cos(angle);
        const baseX2 = centerX + radius2 * Math.cos(angle) + triangleBase / 2 * Math.sin(angle);
        const baseY2 = centerY + radius2 * Math.sin(angle) - triangleBase / 2 * Math.cos(angle);

        // Draw a triangle
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX1, baseY1);
        ctx.lineTo(baseX2, baseY2);
        ctx.closePath();
        ctx.fill();
    });

    ctx.restore();
}

// Function to draw a filled circle

// Function to draw a ring with optional line style

function clampToCircle(obj, circleCenter, maxRadius) {
    const dx = obj.x - circleCenter.x;
    const dy = obj.y - circleCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxRadius && distance > 0) {
        const scale = maxRadius / distance;
        obj.x = circleCenter.x + dx * scale;
        obj.y = circleCenter.y + dy * scale;
    }
}

function startSelectionCycle(firstSelector, trigger = 'normal') {
    const first = firstSelector === 'ai' ? 'ai' : 'human';
    const second = first === 'human' ? 'ai' : 'human';
    if (trigger === 'pause' || trigger === 'intercept') {
        // Pause updates are single-actor confirmation flows:
        // - human manual pause -> human reselects/confirm
        // - AI auto-pause/replan -> AI updates target only
        // Intercept reselection should also be single-actor unless explicitly requested.
        selectionQueue = [first];
    } else {
        selectionQueue = trigger === 'start' ? [first] : [first, second];
    }
    selectionIndex = 0;
    selectionCycleTrigger = trigger;
    pendingHumanSelectionForConfirm = null;
    gamePhase = `${first}_select`;
    aiSelectionPlanned = false;
}

function clearPendingHumanSelectionVisuals() {
    objects.forEach((obj) => {
        obj.marked = false;
        obj.clicked = false;
    });
    pendingHumanSelectionForConfirm = null;
    pendingStartHumanSelection = null;
    player.moving = false;
}

function getFilteredObjectsForCollabPlanner(allObjects) {
    let objectsRemoved = allObjects;
    if (settings.aiAwareness === 'coordinating') {
        objectsRemoved = objectsRemoved.filter(obj => !obj.inPlayerRegion);
    }
    if (settings.aiConstraint === 'no-harm') {
        // Category rule by design: the bot never takes the human's bonus shape,
        // regardless of which target the human actually picked. Deliberately NOT
        // instance-level (i.e. not "skip the human's current selection") so this
        // stays independent of aiAwareness === 'coordinating', which is what
        // handles avoiding the human's region.
        objectsRemoved = objectsRemoved.filter(obj => obj.shape !== 'square');
    }
    if (objectsRemoved.length === 0) {
        objectsRemoved = [{
            ID: -1,
            type: 'target',
            x: center.x,
            y: center.y,
            vx: 0,
            vy: 0,
            dx: 0,
            dy: 0,
            speed: 0,
            size: 1,
            value: 0,
            intercepted: false,
            AIintercepted: false,
            marked: false,
            AImarked: false,
            inPlayerRegion: false,
            shape: 'circle'
        }];
    }
    return objectsRemoved;
}

function planAIFirstTargetForConfirmation() {
    const prevBestSolCollab = bestSolCollab;
    const objectsRemoved = getFilteredObjectsForCollabPlanner(objects);
    [ firstStepCollab, bestSolCollab ] = runAIPlanner(
        objectsRemoved,
        AIplayer,
        observableRadius,
        center,
        'collab',
        settings.AIStabilityThreshold,
        prevBestSolCollab,
        frameCountGame,
        settings.alpha
    );

    AIplayer.targetX = firstStepCollab.x;
    AIplayer.targetY = firstStepCollab.y;
    AIplayer.ID = firstStepCollab.ID;
    AIplayer.toCenter = (AIplayer.ID === -1);

    objects.forEach((obj) => {
        obj.AImarked = false;
    });
    let chosenObj = null;
    if (AIplayer.ID !== -1) {
        chosenObj = objects.find((obj) => obj.ID === AIplayer.ID) || null;
        if (chosenObj) {
            chosenObj.AImarked = true;
            chosenObj.AIclicked = true;
        }
    }
    return chosenObj;
}

function resumeMotionAfterConfirmation() {
    // Ensure both agents resume pursuit after confirmation-driven transitions.
    setPauseButtonActive(true);
    if (player.targetObjID !== null && player.targetObjID !== undefined) {
        player.moving = true;
    }
    if (AIplayer.ID !== null && AIplayer.ID !== undefined) {
        AIplayer.moving = true;
    }
}


function formatTargetLabelHtml(obj) {
    if (!obj) return 'target unknown';
    const level = `Level-${obj.urgency || obj.value || 1}`;
    const shape = String(obj.shape || 'target').toLowerCase();
    return `<strong>target ${obj.ID}</strong> (<strong>${level}</strong> <strong>${shape}</strong>)`;
}

function formatTargetLabelHtmlFromId(targetId) {
    const obj = getObjectById(targetId);
    if (obj) return formatTargetLabelHtml(obj);
    if (targetId === null || targetId === undefined) return 'target unknown';
    return `<strong>target ${targetId}</strong> (<strong>Level-?</strong> <strong>target</strong>)`;
}

function getHumanSelectionConfirmMessage(obj) {
    const label = formatTargetLabelHtml(obj);
    if (selectionCycleTrigger === 'intercept') {
        return `You've selected ${label} as your next target. Do you confirm this selection?`;
    }
    if (selectionCycleTrigger === 'pause') {
        return `You've selected ${label} as your updated target. Do you confirm this selection?`;
    }
    return `You've selected ${label} as your first target. Do you confirm this selection?`;
}


function advanceSelection() {
    selectionIndex += 1;
    if (selectionIndex >= selectionQueue.length) {
        if (WALKTHROUGH_MODE && walkthroughPostPausePending && selectionCycleTrigger === 'pause') {
            // Hard guarantee for tutorial: after pause-reselection flow,
            // proceed to Step 16/17 instead of resuming animation.
            runWalkthroughPostPauseFinalSteps();
            return;
        }
        // AI-only pause/replan path should not require human reselection/confirmation.
        if (!pendingHumanSelectionForConfirm) {
            gamePhase = 'animate';
            isStopped = false;
            resumeMotionAfterConfirmation();
            lastAnimationTimestamp = null;
            pauseCause = null;
            return;
        }

        gamePhase = 'confirm';
        if (!confirmationInProgress) {
            confirmationInProgress = true;
            const confirmMessage = getHumanSelectionConfirmMessage(pendingHumanSelectionForConfirm);
            showCustomConfirm(confirmMessage, true).then((confirmed) => {
                confirmationInProgress = false;
                if (confirmed) {
                    if (WALKTHROUGH_MODE && walkthroughPostPausePending && selectionCycleTrigger === 'pause') {
                        runWalkthroughPostPauseFinalSteps();
                        return;
                    }
                    if (selectionCycleTrigger === 'start') {
                        const confirmedStartSelection = pendingStartHumanSelection || pendingHumanSelectionForConfirm;
                        if (confirmedStartSelection) {
                            addChoiceEntry('Human', confirmedStartSelection, { deferStartHuman: false });
                        }
                        let aiChosenObj = planAIFirstTargetForConfirmation();
                        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_9') {
                            // Tutorial: hardcode the AI's first target to make the demo
                            // fully deterministic (fixed seed -> known IDs).
                            const excludedHumanId = confirmedStartSelection ? confirmedStartSelection.ID : null;
                            const hardcoded = getHardcodedWalkthroughTargetById(WALKTHROUGH_AI_FIRST_TARGET_ID, excludedHumanId);
                            if (hardcoded) {
                                aiChosenObj = hardcoded;
                                applyChosenAITargetForWalkthrough(hardcoded);
                                // Keep planner-internal state in sync so subsequent
                                // stability checks compare against the forced target.
                                if (bestSolCollab) { bestSolCollab.ID = hardcoded.ID; }
                            } else if (confirmedStartSelection && aiChosenObj && aiChosenObj.ID === confirmedStartSelection.ID) {
                                // Fallback: if hardcoded target is unavailable AND planner
                                // would pick the human's target, pick another close target.
                                const fallbackAiObj = pickWalkthroughAITargetAvoiding(confirmedStartSelection.ID);
                                aiChosenObj = fallbackAiObj;
                                applyChosenAITargetForWalkthrough(aiChosenObj);
                            }
                        }
                        const aiMessage = aiChosenObj
                            ? `The AI selected <strong>target ${aiChosenObj.ID}</strong> (<strong>Level-${aiChosenObj.urgency || aiChosenObj.value || 1}</strong> <strong>${String(aiChosenObj.shape || 'target').toLowerCase()}</strong>) as their first target.`
                            : 'The AI selected no target and will return to center.';
                        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_9') {
                            showWalkthroughInstruction("After you make your choice, your AI teammate will pick a target too. In the field, your selected target is marked with a red cross (since your icon is in red), and the AI's selected target is marked with another cross in the same color as the AI's icon (in this example, blue).", '#gameCanvas', 'Next').then(() => {
                                const aiChosenAlertPromise = showCustomAlert(aiMessage, true);
                                // Show this walkthrough hint while the action-panel OK is visible.
                                showWalkthroughInstruction(
                                    "You can also see details about the AI's chosen target in the action panel. Click OK to confirm you've seen it.",
                                    '#actionCard',
                                    'Next',
                                    { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertOkButton' }
                                );
                                aiChosenAlertPromise.then(() => {
                                    addChoiceEntry('Bot', aiChosenObj);
                                    pendingStartHumanSelection = null;
                                    pendingHumanSelectionForConfirm = null;
                                    gamePhase = 'animate';
                                    isStopped = false;
                                    setWalkthroughStage('await_human_catch_after_first_animation');
                                    resumeMotionAfterConfirmation();
                                    lastAnimationTimestamp = null;
                                    pauseCause = null;
                                });
                            });
                        } else {
                            showCustomAlert(aiMessage, true).then(() => {
                                addChoiceEntry('Bot', aiChosenObj);
                                pendingStartHumanSelection = null;
                                pendingHumanSelectionForConfirm = null;
                                gamePhase = 'animate';
                                isStopped = false;
                                resumeMotionAfterConfirmation();
                                lastAnimationTimestamp = null;
                                pauseCause = null;
                            });
                        }
                    } else {
                        if (pendingHumanSelectionForConfirm) {
                            addChoiceEntry('Human', pendingHumanSelectionForConfirm, { deferStartHuman: false });
                        }
                        if (WALKTHROUGH_MODE && walkthroughPostPausePending) {
                            pendingAIReselectAfterHuman = null;
                            runWalkthroughPostPauseFinalSteps();
                            return;
                        }
                        if (pendingAIReselectAfterHuman) {
                            const aiChosenObj = planAIFirstTargetForConfirmation();
                            const oldLabel = pendingAIReselectAfterHuman.oldObj
                                ? formatTargetLabelHtml(pendingAIReselectAfterHuman.oldObj)
                                : formatTargetLabelHtmlFromId(pendingAIReselectAfterHuman.oldTargetId);
                            const newLabel = aiChosenObj
                                ? formatTargetLabelHtml(aiChosenObj)
                                : 'no target (return to center)';
                            const aiUpdateMessage = pendingAIReselectAfterHuman.reason === 'same_target'
                                ? `Since the AI's selected target was caught by you, they updated their target to ${newLabel}.`
                                : `The AI updated their target from ${oldLabel} to ${newLabel}.`;
                            showCustomAlert(aiUpdateMessage, true).then(() => {
                                const previousTrigger = selectionCycleTrigger;
                                selectionCycleTrigger = pendingAIReselectAfterHuman.reason === 'same_target' ? 'pause' : 'intercept';
                                addChoiceEntry('Bot', aiChosenObj);
                                selectionCycleTrigger = previousTrigger;
                                pendingAIReselectAfterHuman = null;
                                gamePhase = 'animate';
                                isStopped = false;
                                resumeMotionAfterConfirmation();
                                lastAnimationTimestamp = null;
                                pendingHumanSelectionForConfirm = null;
                                pauseCause = null;
                            });
                            return;
                        }
                        gamePhase = 'animate';
                        isStopped = false;
                        resumeMotionAfterConfirmation();
                        lastAnimationTimestamp = null;
                        pendingHumanSelectionForConfirm = null;
                        pauseCause = null;
                        if (WALKTHROUGH_MODE && walkthroughStage === 'confirmed_10') {
                            scheduleWalkthroughPauseButtonDemo();
                        }
                    }
                } else {
                    clearPendingHumanSelectionVisuals();
                    const restartTrigger = selectionCycleTrigger === 'intercept'
                        ? 'intercept'
                        : (selectionCycleTrigger === 'start' ? 'start' : 'pause');
                    startSelectionCycle('human', restartTrigger);
                    showCustomAlertNoButton('Select in the field which target you want to catch');
                }
            });
        }
        return;
    }
    const next = selectionQueue[selectionIndex];
    gamePhase = `${next}_select`;
    aiSelectionPlanned = false;
}

function addChoiceEntry(actorLabel, obj, options = {}) {
    const { deferStartHuman = true } = options;
    if (
        deferStartHuman &&
        selectionCycleTrigger === 'start' &&
        actorLabel === 'Human' &&
        !hasActorSelectedTarget.Human
    ) {
        pendingStartHumanSelection = obj;
        return;
    }

    const targetLabel = obj
        ? `${obj.shape || 'target'} #${obj.ID} (v=${obj.value})`
        : 'center';

    const actorText = actorLabel === 'Bot' ? 'The AI' : 'You';
    const shapeText = obj ? String(obj.shape || 'target').toLowerCase() : 'center';
    const levelText = obj ? `Level-${obj.urgency || obj.value || 1}` : 'Level-0';
    const targetIndex = obj ? obj.ID : 'center';
    const previousTarget = lastSelectedTargetByActor[actorLabel];
    const didActuallyChangeTarget = previousTarget !== targetIndex;
    let description = `${actorText} selected target ${targetIndex} (${levelText} ${shapeText}).`;

    if (selectionCycleTrigger === 'intercept') {
        if (actorLabel === 'Bot' && !didActuallyChangeTarget) {
            return;
        }
        const nextPronoun = actorLabel === 'Bot' ? 'their' : 'your';
        description = `${actorText} selected target ${targetIndex} (${levelText} ${shapeText}) as ${nextPronoun} next target.`;
    } else if (selectionCycleTrigger === 'pause') {
        if (actorLabel === 'Bot') {
            description = `The AI changed their target to target ${targetIndex} (${levelText} ${shapeText}).`;
        } else {
            description = `You changed your target to target ${targetIndex} (${levelText} ${shapeText}).`;
        }
    } else if (!hasActorSelectedTarget[actorLabel]) {
        description = `${actorText} selected target ${targetIndex} (${levelText} ${shapeText}) as the first target.`;
    }

    hasActorSelectedTarget[actorLabel] = true;
    lastSelectedTargetByActor[actorLabel] = targetIndex;

    const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const entry = {
        actor: actorLabel,
        target: targetLabel,
        timestamp,
        description
    };
    choiceHistory.push(entry);
    if (choiceHistory.length > maxChoiceHistory) choiceHistory.shift();
    updateChoiceSummary();
}

function addHistoryMessage(message, actorLabel = 'Human') {
    const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const entry = {
        actor: actorLabel,
        target: null,
        timestamp,
        description: message
    };
    choiceHistory.push(entry);
    if (choiceHistory.length > maxChoiceHistory) choiceHistory.shift();
    updateChoiceSummary();
}

function updateChoiceSummary() {
    const summaryBody = document.getElementById('choiceSummaryBody');
    const currentSelectionCard = document.getElementById('currentSelectionCard');
    const summaryScroll = document.getElementById('choiceSummaryScroll');
    if (!summaryBody || !currentSelectionCard) return;
    summaryBody.innerHTML = '';
    currentSelectionCard.innerHTML = '';

    const formatCurrentTarget = (targetId) => {
        if (targetId === null || targetId === undefined) return 'N/A';
        if (targetId === 'center') return 'center';
        return `target ${targetId}`;
    };

    const currentSelectionSummary = document.createElement('div');
    currentSelectionSummary.className = 'currentSelectionSummary';
    currentSelectionSummary.innerHTML =
        `<span>Human's current target: ${formatCurrentTarget(lastSelectedTargetByActor.Human)}</span>` +
        ` <span class="selection-separator">|</span> ` +
        `<span>AI's current target: ${formatCurrentTarget(lastSelectedTargetByActor.Bot)}</span>`;
    currentSelectionCard.appendChild(currentSelectionSummary);

    function createHistoryEntryNode(entry, isCurrent = false) {
        const row = document.createElement('div');
        row.className = isCurrent ? 'historyEntry current' : 'historyEntry';

        const icon = document.createElement('img');
        icon.className = 'historyIcon';
        if (entry.actor === 'Bot') {
            icon.src = '../images/simple-robot-line-removebg-preview.png';
            icon.alt = 'AI icon';
            icon.style.backgroundColor = AIplayer.color;
        } else {
            icon.src = '../images/human-head-small.png';
            icon.alt = 'Human icon';
            icon.style.backgroundColor = player.color;
        }

        const content = document.createElement('div');
        content.className = 'historyContent';

        const description = document.createElement('div');
        description.className = 'historyDescription';
        description.textContent = entry.description || `${entry.actor === 'Bot' ? 'AI' : entry.actor} selected ${entry.target}`;

        const timestamp = document.createElement('div');
        timestamp.className = 'historyTimestamp';
        timestamp.textContent = entry.timestamp || '';

        content.appendChild(description);
        content.appendChild(timestamp);
        row.appendChild(icon);
        row.appendChild(content);
        return row;
    }

    if (choiceHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'historyTimestamp';
        empty.style.textAlign = 'left';
        empty.textContent = 'No past selections yet.';
        summaryBody.appendChild(empty);
        return;
    }

    // Past -> recent ordering (earliest on top, newest at bottom).
    for (let i = 0; i < choiceHistory.length; i++) {
        summaryBody.appendChild(createHistoryEntryNode(choiceHistory[i], false));
    }

    // Keep scrollbar pinned to latest selection by default.
    if (summaryScroll) {
        summaryScroll.scrollTop = summaryScroll.scrollHeight;
        window.requestAnimationFrame(() => {
            summaryScroll.scrollTop = summaryScroll.scrollHeight;
        });
    }
}

function drawDebugID(obj) {
    // set the text color
    ctx.fillStyle = 'black';
    // set the font
    ctx.font = '16px Arial';
    // draw the ID above the object
    ctx.fillText(obj.ID, obj.x, obj.y - 20);
}

// MS2: added this function just for debugging; it continues to draw the targets even when intercepted
function drawCompositeShapeDEBUG(obj) {
    // Draw the outer circle first
    drawCircle(obj.x, obj.y, obj.size, 'LightGrey' ); // Outer circle

    // Then draw the inner circle on top
    drawCircle(obj.x, obj.y, obj.fill, 'gray' ); // Inner circle, smaller radius
}

// MS5: added this function just for debugging; it shows when AI player has intercepted target
function drawCompositeShapeAI(obj) {
    // Draw the outer circle first
    drawCircle(obj.x, obj.y, obj.size, 'LightGrey' ); // Outer circle

    // Then draw the inner circle on top
    drawCircle(obj.x, obj.y, obj.fill, 'gray' ); // Inner circle, smaller radius
}


function drawVelocityVector(obj) {
    if (isWithinCanvas(obj)) {
        const arrowLength = 35;
        const headLength = 8;
        const headWidth = 8;
        const angle = Math.atan2(obj.vy, obj.vx);
        let arrowColor = obj.innerColor || 'rgba(40, 80, 255, 0.95)';
        if (obj.shape === 'square') {
            arrowColor = player.color;
        } else if (obj.shape === 'triangle') {
            arrowColor = AIplayer.color;
        }

        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.rotate(angle);
        ctx.strokeStyle = arrowColor;
        ctx.fillStyle = arrowColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(arrowLength - headLength, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(arrowLength, 0);
        ctx.lineTo(arrowLength - headLength, -headWidth / 2);
        ctx.lineTo(arrowLength - headLength, headWidth / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

function isWithinCanvas(obj) {
    return obj.x >= 0 && obj.x <= canvas.width && obj.y >= 0 && obj.y <= canvas.height;
}

function drawScore() {
    if (!teamScoreValue || !yourScoreValue || !aiScoreValue) return;
    teamScoreValue.textContent = String(totalScore);
    yourScoreValue.textContent = String(player.score);
    aiScoreValue.textContent = String(AIplayer.score);
}

// drawing outer mask
function drawMask(ctx) {
    if (!ctx) {
        console.error('drawMask: No drawing context provided');
        return;
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maskRadius = 400; // Adjust as necessary

    ctx.save();

    // Draw a black rectangle covering the entire canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Then cut out a circular area from the rectangle
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(centerX, centerY, maskRadius, 0, Math.PI * 2, false);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
}

// Function to where the player is heading


function drawAISolution() {
    if ((settings.AIMode>0) && (bestSol != null) && (player.shownAdvice)) {  // MS7
        // get the length of the suggested path
        let pathLength = Math.min( bestSol.interceptLocations.length, settings.AIMaxDisplayLength ); // MS7
        if (pathLength > 0) {
            // MS7
            if (settings.AIDisplayMode==0) {
                // Show where to move with lines
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; // Adjust the last number for transparency 
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y );
                for (let i=0; i<pathLength; i++) {
                    let transp = (i+1)/3;
                    ctx.strokeStyle = 'rgba(255, 255, 0, ' + transp + ')'; // Adjust the last number for transparency
                    let toX = bestSol.interceptLocations[i][0];
                    let toY = bestSol.interceptLocations[i][1];
                    ctx.lineTo( toX, toY );
                }
                ctx.stroke();
                ctx.restore();
            }

            // MS7: updating code with new variable
             if (settings.AIDisplayMode==1) {
                // Show a cross on where to click next 
                ctx.save();
                ctx.fillStyle = 'yellow'; // Color of the text
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; // Adjust the last number for transparency
                ctx.lineWidth = 5;
                ctx.beginPath();

                ctx.moveTo(player.x, player.y );

                let i = 0;
                //for (let i=0; i<pathLength; i++) {
                    let toX = bestSol.interceptLocations[i][0];
                    let toY = bestSol.interceptLocations[i][1];
                    
                    ctx.lineTo( toX, toY ); 
                    ctx.moveTo(toX - 10, toY - 10);
                    ctx.lineTo(toX + 10, toY + 10);
                    ctx.moveTo(toX + 10, toY - 10);
                    ctx.lineTo(toX - 10, toY + 10); 

                    // Draw text
                    // Adjust the text position as needed. Here it's slightly offset from the cross.
                    //ctx.fillText(i+1, toX + 15, toY + 15); 
                //}
                ctx.stroke();
                ctx.restore();
            }

            if (settings.AIDisplayMode==2) {
                // Highlight the target interception sequence 
                ctx.save();
                ctx.fillStyle = 'black'; // Color of the text
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; // Adjust the last number for transparency
                ctx.lineWidth = 5;
                ctx.beginPath();

                let i = 0;
                for (let i=0; i<pathLength; i++) {
                    let indexNow = bestSol.originalIndex[i];
                    if (indexNow != -1) {
                        let toX = objects[indexNow].x;
                        let toY = objects[indexNow].y;                      
                        // Draw text
                        //ctx.fillText(i+1, toX + 25, toY + 25); 

                        // Draw an arrow to the first one
                        if (i==0) {
                            drawFilledArrow(ctx, toX - 25 , toY, 10); 
                        }
                    }
                    
                }
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    // MS7
    // Some visualization debugging tools
    let showIDs = false;
    if (showIDs) {
        let numObjects = objects.length;
        for (let i=0; i<numObjects; i++) {
            // only draw the objects that are not intercepted
            if (objects[i].intercepted == false) {
                let index = objects[i].ID;
                let targetX = objects[i].x;
                let targetY = objects[i].y;
                ctx.fillStyle = 'black'; // Color of the text
                ctx.fillText(index , targetX + 15, targetY + 15);
            }          
        }
    }
}

// MS6: test function

// MS4: draw arrow
function drawFilledArrow(ctx, toX, toY, arrowWidth) {
    const arrowLength = arrowWidth * 4; // Adjust the length of the arrow as needed
    const headLength = arrowWidth * 0.6; // Length of the head of the arrow
    const headWidth = arrowWidth * 1.4; // Width of the head of the arrow

    // Starting points for the arrow (adjust as necessary)
    const fromX = toX - arrowLength;
    const fromY = toY;

    // Set the fill color
    //ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
    //ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; // Adjust the last number for transparency
    ctx.fillStyle = 'yellow';
    //ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; // Adjust the last number for transparency


    // Begin a new path for the arrow
    ctx.beginPath();

    // Draw the arrow body as a rectangle
    ctx.rect(fromX, fromY - arrowWidth / 2, arrowLength - headLength, arrowWidth);

    // Draw the arrow head as a triangle
    ctx.moveTo(toX - headLength, toY - headWidth / 2);
    ctx.lineTo(toX, toY);
    ctx.lineTo(toX - headLength, toY + headWidth / 2);

    // Close the path and fill the arrow with the set color
    ctx.closePath();
    ctx.fill();
}

// Messaging board status + AI image type
function displayAIStatus() {
    const aiAssistRobot = document.getElementById("aiAssistRobot");
    const aiAssistRobotCaption = document.getElementById("aiAssistRobotCaption");
    if (!aiAssistRobot || !aiAssistRobotCaption) return;

    let curMaxTargets = settings.maxTargets;

    if (AIplayer.collabOrder == 1 && curMaxTargets == 5) {
        aiAssistRobot.src = "../images/simple-robot-line-removebg-preview.png";
        aiAssistRobot.style.backgroundColor = AIplayer.color;
        aiAssistRobotCaption.textContent = "Hi there! I'm your AI teammate. I'll be controlling the green square.";
        aiAssistRobotCaption.style.opacity = "1";
        aiAssistRobotCaption.style.backgroundColor = AIplayer.color;; // Semi-transparent green
        aiAssistRobotCaption.style.fontWeight = "bold";
    } else if (AIplayer.collabOrder == 2 && curMaxTargets == 5) {
        aiAssistRobot.src = "../images/simple-robot-line-removebg-preview.png";
        aiAssistRobot.style.backgroundColor = AIplayer.color;
        aiAssistRobotCaption.textContent = "Howdy! I'm your AI teammate. I'll be controlling the purple square.";
        aiAssistRobotCaption.style.opacity = "1";
        aiAssistRobotCaption.style.backgroundColor = "rgba(128, 0, 128, 0.5)"; // Semi-transparent purple
        aiAssistRobotCaption.style.fontWeight = "bold";
    } else if (AIplayer.collabOrder == 1 && curMaxTargets == 15) {
        aiAssistRobot.src = "../images/simple-robot-line-removebg-preview.png";
        aiAssistRobot.style.backgroundColor = AIplayer.color;
        aiAssistRobotCaption.textContent = "Ahoy! I'm your AI teammate. I'll be controlling the blue square.";
        aiAssistRobotCaption.style.opacity = "1";
        aiAssistRobotCaption.style.backgroundColor = AIplayer.color;; // Semi-transparent brown
        aiAssistRobotCaption.style.fontWeight = "bold";
    } else if (AIplayer.collabOrder == 2 && curMaxTargets == 15) {
        aiAssistRobot.src = "../images/simple-robot-line-removebg-preview.png";
        aiAssistRobot.style.backgroundColor = AIplayer.color;
        aiAssistRobotCaption.textContent = "G'day! I'm your AI teammate. I'll be controlling the copper-colored square.";
        aiAssistRobotCaption.style.opacity = "1";
        aiAssistRobotCaption.style.backgroundColor = AIplayer.color; // Semi-transparent blue
        aiAssistRobotCaption.style.fontWeight = "bold";
    } 
}

// Custom alert message in order to pause the game and display text
function showCustomAlert(message, useHtml = false) {
    return new Promise((resolve) => {
        // Disable pause while a modal instruction is open.
        setPauseButtonActive(false);
        if (useHtml) {
            $('#customAlertMessage').html(message);
        } else {
            $('#customAlertMessage').text(message);
        }
        $('#customAlertConfirmButton').hide();
        $('#customAlertCancelButton').hide();
        $('#customAlertOkButton').show();
        $('#customAlert').show();

        $('#customAlertOkButton').off('click').one('click', function() {
            $('#customAlert').hide();
            // Re-enable only when animation is actively running.
            setPauseButtonActive(gamePhase === 'animate' && !isStopped);
            resolve();
        });
    });
}

function showCustomConfirm(message, useHtml = false) {
    return new Promise((resolve) => {
        // Disable pause while confirm/cancel is pending.
        setPauseButtonActive(false);
        if (useHtml) {
            $('#customAlertMessage').html(message);
        } else {
            $('#customAlertMessage').text(message);
        }
        $('#customAlertOkButton').hide();
        $('#customAlertConfirmButton').show();
        $('#customAlertCancelButton').off('click');
        // Tutorial only (`walkthrough-game.html` -> this file): hide Cancel for
        // first-target and next-target confirms. Pause reselect still shows Cancel.
        const confirmOnly =
            selectionCycleTrigger === 'start' || selectionCycleTrigger === 'intercept';
        if (confirmOnly) {
            $('#customAlertCancelButton').hide();
        } else {
            $('#customAlertCancelButton').show();
        }
        $('#customAlert').show();

        $('#customAlertConfirmButton').off('click').one('click', function() {
            $('#customAlert').hide();
            setPauseButtonActive(gamePhase === 'animate' && !isStopped);
            if (WALKTHROUGH_MODE) {
                if (walkthroughStage === 'await_confirm_9') setWalkthroughStage('confirmed_9');
                if (walkthroughStage === 'await_confirm_10') {
                    walkthroughRequiredTargetId = null;
                    setWalkthroughStage('confirmed_10');
                }
            }
            resolve(true);
        });
        if (!confirmOnly) {
            $('#customAlertCancelButton').off('click').one('click', function() {
                $('#customAlert').hide();
                setPauseButtonActive(gamePhase === 'animate' && !isStopped);
                if (WALKTHROUGH_MODE) {
                    if (walkthroughStage === 'await_confirm_9') {
                        setWalkthroughStage('await_target_9');
                    } else if (walkthroughStage === 'await_confirm_10') {
                        setWalkthroughStage('await_target_10');
                    }
                }
                resolve(false);
            });
        }
    });
}

function closeCustomAlert() {
    $('#customAlert').hide();
}

function showCustomAlertNoButton(message, useHtml = false) {
    setPauseButtonActive(false);
    if (useHtml) {
        $('#customAlertMessage').html(message);
    } else {
        $('#customAlertMessage').text(message);
    }
    $('#customAlertConfirmButton').hide();
    $('#customAlertCancelButton').hide();
    $('#customAlertOkButton').hide();
    $('#customAlert').show();
}
// *************************************** INTERCEPTION ALGORITHMS ********************************** //
// Intercept Function for the Player
function attemptInterceptLocal(playerPosX, playerPosY, playerSpeed, objectPosX, objectPosY, objectVelX, objectVelY, circleRadius) {
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
        if (DEBUG) console.log( 'Null values');
    }

    return [ success, travelTime, interceptPosX, interceptPosY, totalDistanceTraveled ];
}

function splitGameHalf(obj) {
    // Center of the game view
    const center = { x: canvas.width / 2, y: canvas.height / 2 };

    // Calculate the angle from the center to the player
    let playerAngle = Math.atan2(player.y - center.y, player.x - center.x);

    // Calculate the orthogonal angle (90 degrees or PI/2 radians)
    let orthoAngle = playerAngle + Math.PI / 2;

    // Calculate the angle between the object and the center
    let objAngle = Math.atan2(obj.y - center.y, obj.x - center.x);

    // Normalize angles to range [0, 2*PI)
    function normalizeAngle(angle) {
        return (angle + 2 * Math.PI) % (2 * Math.PI);
    }

    let normalizedObjAngle = normalizeAngle(objAngle);
    let normalizedPlayerAngle = normalizeAngle(playerAngle);
    let normalizedOrthoAngle = normalizeAngle(orthoAngle);

    // Check if object is in the player's allotted pi region
    let angleDifference = Math.abs(normalizedObjAngle - normalizedPlayerAngle);

    // Determine if the object is on the left or right side of the orthogonal line
    let isInPlayerHalf = angleDifference < Math.PI / 2 || angleDifference > (3 * Math.PI) / 2;

    // if (DEBUG) {
    //     // Function to draw the orthogonal line for debugging
    //     function drawPlayerHalfDEBUG() {
    //         let orthoLineX = player.x + 100 * Math.cos(orthoAngle); // arbitrary length
    //         let orthoLineY = player.y + 100 * Math.sin(orthoAngle); // arbitrary length
    //         // Implement your drawing logic here
    //         console.log(`Drawing orthogonal line to (${orthoLineX}, ${orthoLineY})`);
    //     }

    //     drawPlayerHalfDEBUG();
    // }

    return isInPlayerHalf;
}

// ***************************************** EVENT LISTENERS ***************************************** //
let lastClickedObj = null;
$(document).ready( function(){
    // Participants stay blind to the agent condition: the experimenter panel is
    // only shown with ?admin=true.
    const adminTopBar = document.getElementById('adminTopBar');
    if (adminTopBar && new URLSearchParams(window.location.search).get('admin') === 'true') {
        adminTopBar.hidden = false;
    }

    const constraintSelect = document.getElementById('constraintSelect');
    if (constraintSelect) {
        constraintSelect.value = settings.aiConstraint;
        constraintSelect.addEventListener('change', async () => {
            settings.aiConstraint = constraintSelect.value || settings.aiConstraint;
            if (DEBUG) console.log('Constraint changed to', settings.aiConstraint);
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }

    const objectiveSelect = document.getElementById('objectiveSelect');
    if (objectiveSelect) {
        objectiveSelect.value = settings.aiObjective;
        objectiveSelect.addEventListener('change', async () => {
            settings.aiObjective = objectiveSelect.value || settings.aiObjective;
            if (DEBUG) console.log('Objective changed to', settings.aiObjective);
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }

    const awarenessSelect = document.getElementById('awarenessSelect');
    if (awarenessSelect) {
        awarenessSelect.value = settings.aiAwareness;
        awarenessSelect.addEventListener('change', async () => {
            settings.aiAwareness = awarenessSelect.value || settings.aiAwareness;
            if (DEBUG) console.log('Awareness changed to', settings.aiAwareness);
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }

    const humanBonusSelect = document.getElementById('humanBonusSelect');
    if (humanBonusSelect) {
        humanBonusSelect.value = String(settings.humanBonusPerSquare);
        humanBonusSelect.addEventListener('change', async () => {
            const bonus = parseInt(humanBonusSelect.value, 10);
            if (!Number.isNaN(bonus)) {
                settings.humanBonusPerSquare = bonus;
            }
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }

    const aiBonusSelect = document.getElementById('aiBonusSelect');
    if (aiBonusSelect) {
        aiBonusSelect.value = String(settings.aiBonusPerTriangle);
        aiBonusSelect.addEventListener('change', async () => {
            const bonus = parseInt(aiBonusSelect.value, 10);
            if (!Number.isNaN(bonus)) {
                settings.aiBonusPerTriangle = bonus;
            }
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }

    const densityRange = document.getElementById('densityRange');
    const densityValue = document.getElementById('densityValue');
    if (densityRange) {
        densityRange.value = String(settings.maxTargets);
        if (densityValue) densityValue.textContent = densityRange.value;
        densityRange.addEventListener('input', async () => {
            const maxTargets = parseInt(densityRange.value, 10);
            if (!Number.isNaN(maxTargets)) {
                settings.maxTargets = maxTargets;
                if (densityValue) densityValue.textContent = densityRange.value;
            }
            if (isGameRunning) {
                isGameRunning = false;
                await resetGame();
                startGame(currentRound, currentCondition, currentBlock, curSeeds);
            }
        });
    }
   // Event listener for player click locations
   canvas.addEventListener('click', function(event) {
        // Get the position of the click relative to the canvas
        // Check not first click so that initializing game doesn't leed to player movement
        const rect = canvas.getBoundingClientRect();
        // Canvas is displayed responsively; convert screen-space click to canvas-space coordinates.
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clickX = (event.clientX - rect.left) * scaleX;
        const clickY = (event.clientY - rect.top) * scaleY;

        // Lock playfield selections until the user explicitly starts the game.
        if (gamePhase !== 'human_select') return;

        // Calculate the angle from the player to the click position
        const deltaX = clickX - (player.x + player.width / 2);
        const deltaY = clickY - (player.y + player.height / 2);
        player.angle = Math.atan2(deltaY, deltaX);

        // console.log('Player clicked:', clickX, clickY);
        let playerStartX = 0;
        let playerStartY = 0;

        let objectStartX = 0;
        let objectStartY = 0;

        let objectVelX = 0;
        let objectVelY = 0;

        let success, travelTime, interceptPosX, interceptPosY, totalDistanceTraveled = 0;

        // Extract the game state for the click and then ush into the playerClicks dataframe
        let gameSnapshot = extractGameState(objects);
        // if (DEBUG) console.log('gameSnapshot:', gameSnapshot);  

        // check if player clicked on a target
        for (let i = 0; i < objects.length; i++) {
            // Only currently selectable targets should participate in hit-testing.
            // This prevents hidden/stale targets from blocking a valid click nearby.
            if (!objects[i].active || objects[i].intercepted) {
                continue;
            }

            if (isClickOnObject(objects[i], clickX, clickY)) {
                if (WALKTHROUGH_MODE && walkthroughRequiredTargetId !== null && objects[i].ID !== walkthroughRequiredTargetId) {
                    const requiredId = walkthroughRequiredTargetId;
                    const retryMessage = walkthroughStage === 'await_target_9'
                        ? `For this tutorial, please select <strong>target ${requiredId}</strong>, which is the closest intercept-able target to your icon.`
                        : `For this tutorial, please select <strong>target ${requiredId}</strong>, which is sufficiently far away from your current location.`;
                    showWalkthroughInstruction(retryMessage, '#gameCanvas', 'Next');
                    return;
                }

                // The click is on this object
                objects[i].clicked = true;
                objects[i].marked = true;

                // unmark the previous target object
                for (let j = 0; j < objects.length; j++) {
                    if (i !== j) {
                        objects[j].marked = false;
                    }
                }

                playerStartX = ( player.x - center.x );
                playerStartY = ( player.y - center.y );

                objectStartX = ( objects[i].x - center.x );
                objectStartY = ( objects[i].y - center.y );

                objectVelX = objects[i].vx * objects[i].speed;
                objectVelY = objects[i].vy * objects[i].speed;


                // ********* CALCULATE THE DELAY IN PLANNING ********* //

                // num frames it took to make a new target choice 
                // if (player.targetObjID != null && player.targetObjID != objects[i].ID) { // add a delay variable when a new object is clicked
                if (!player.moving){ // only clicks that happen when the player is not moving
                    // console.log("number delays", clickTimes.length);
                    // console.log("Number of Frames Player not Moving", numFramesPlayernotMoving)
                    clickTimes.push(numFramesPlayernotMoving);
                 
                    let lastNumClicks = 5;  
                    avgResponseTime = getExponentialMovingAverage(lastNumClicks);
                    // console.log("Average Response Time", avgResponseTime);
                }        

                planDelayFrames = Math.floor(avgResponseTime);

                let circleRadius = 390;

                [success, travelTime, interceptPosX, 
                interceptPosY, totalDistanceTraveled] = attemptInterceptLocal(playerStartX,playerStartY, player.velocity, 
                                                        objectStartX, objectStartY, objectVelX, objectVelY, circleRadius);

                // Allow any active target selection. If interception math fails,
                // fall back to chasing the target's current position.
                if (!success || !Number.isFinite(interceptPosX) || !Number.isFinite(interceptPosY)) {
                    if (DEBUG) console.log('Fallback chase for clicked target', objects[i].ID);
                    player.targetX = objects[i].x;
                    player.targetY = objects[i].y;
                } else {
                    // Intercept the clicked object using the optimal intercept location
                    player.targetX = interceptPosX + center.x;
                    player.targetY = interceptPosY + center.y;
                }
                player.moving = true;
                player.targetObjID = objects[i].ID;
                player.toCenter = false;
                player.timeToIntercept = travelTime;
                pendingHumanSelectionForConfirm = objects[i];
                if (WALKTHROUGH_MODE) {
                    if (walkthroughStage === 'await_target_9' && (walkthroughRequiredTargetId === null || objects[i].ID === walkthroughRequiredTargetId)) {
                        setWalkthroughStage('await_confirm_9');
                    } else if (walkthroughStage === 'await_target_10' && (walkthroughRequiredTargetId === null || objects[i].ID === walkthroughRequiredTargetId)) {
                        setWalkthroughStage('await_confirm_10');
                    }
                }
                if (WALKTHROUGH_MODE && walkthroughStage === 'await_confirm_9') {
                    // First open the real confirm prompt in the action panel,
                    // then overlay this instruction so it aligns with the
                    // visible Confirm button.
                    advanceSelection();
                    window.setTimeout(() => {
                        showWalkthroughInstruction(
                            `After you select a target, you'll be asked to confirm your choice in the action panel.<br><br>For now, click the <strong>Confirm</strong> button to go after <strong>target ${objects[i].ID}</strong>.`,
                            '#actionCard',
                            'Next',
                            { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertConfirmButton' }
                        );
                    }, 0);
                    return;
                }
                if (WALKTHROUGH_MODE && walkthroughStage === 'await_confirm_10') {
                    // First open the real confirm prompt in the action panel,
                    // then overlay this instruction so it aligns with the
                    // visible Confirm button.
                    advanceSelection();
                    window.setTimeout(() => {
                        showWalkthroughInstruction(
                            walkthroughRequiredTargetId !== null
                                ? `Click the <strong>Confirm</strong> button to go after <strong>target ${walkthroughRequiredTargetId}</strong> and have the game run the animation.`
                                : "Click the <strong>Confirm</strong> button to confirm your selection and have the game run the animation.",
                            '#actionCard',
                            'Next',
                            { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertConfirmButton' }
                        );
                    }, 0);
                    return;
                }
                advanceSelection();

                // (Sanity Check) Keep logging only; do not recolor selected targets.
                if (totalDistanceTraveled == Infinity){
                    if (DEBUG) console.log('No interception possible');
                }
                
                if (DEBUG) console.log("frames player not moving", numFramesPlayernotMoving);
                if (DEBUG) console.log("ai frame delay relative to human :", planDelayFrames);

                // Values for writing to dataframe
                let objectData      = {ID: objects[i].ID, value: objects[i].value,
                                    x: objects[i].x, y: objects[i].y,
                                    dx: objects[i].dx, dy: objects[i].dy,
                                    vx: objects[i].vx, vy: objects[i].vy, speed: objects[i].speed,
                                    clicked: objects[i].clicked, marked: objects[i].marked, AImarked: objects[i].AImarked};

                let playerData      = {x: player.x, y: player.y, speed: player.velocity, 
                                    dx: player.dx, dy: player.dy,
                                    targetX: player.targetX, targetY: player.targetY,
                                    angle: player.angle, moving: player.moving,
                                    score:player.score, AIscore: AIplayer.score, 
                                    playerDelay: numFramesPlayernotMoving, AIplayerDelay: planDelayFrames};

                let interceptData   = {x: interceptPosX, y: interceptPosY, time: travelTime, distance: totalDistanceTraveled,  
                                        intendedTarget: player.targetObjID, AIintendedTarget: AIplayer.ID};
                let eventType       = 'clickObject';

                // collapse the 4 object events (spawning, collision, clicking, exiting) into one 1 dataframe
                let eventObject     = {time: frameCountGame, eventType: eventType, 
                                    objectData: objectData, playerData: playerData, 
                                    interceptData: interceptData, gameState: gameSnapshot};

                eventStream.push(eventObject)

                // if (DEBUG) console.log('Object Click eventObject:', eventObject);
                return;
            }  
            // Center marker is not a selectable target for the human.
            player.toCenter = false;
        }
    });

    window.closeCustomAlert = closeCustomAlert; // Add closeCustomAlert to the global scope
    
    // Stop button event listener
    const stopButton = document.getElementById('stopButton');
    if (stopButton) {
        stopButton.addEventListener('click', function() {
            if (gamePhase === 'animate' && !isStopped) {
                addHistoryMessage('You paused the game', 'Human');
                pauseCause = 'human_manual';
            }
            stopGame();
        });
    }

    // Continue button event listener
    const continueButton = document.getElementById('continueButton');
    if (continueButton) {
        continueButton.addEventListener('click', function() {
            if (WALKTHROUGH_MODE && walkthroughStage === 'await_start_click') {
                setWalkthroughStage('await_start_ok_then_target_9');
            }
            if (!hasLoggedStartEvent) {
                addHistoryMessage('You started the game', 'Human');
                hasLoggedStartEvent = true;
                setStartButtonActive(false);
            }
            resumeGame();
        });
    }

    const replayTutorialButton = document.getElementById('replayTutorialButton');
    if (replayTutorialButton) {
        if (!WALKTHROUGH_MODE) {
            replayTutorialButton.style.display = 'none';
        } else {
            // walkthrough-only: keep the button disabled during the walkthrough
            // so users cannot accidentally click it mid-tutorial. It is
            // re-enabled in runWalkthroughPostPauseFinalSteps() at the very
            // last instruction (Step 17).
            replayTutorialButton.disabled = true;
        }
        replayTutorialButton.addEventListener('click', function() {
            window.open('replay-tutorial-video.html', '_blank', 'noopener');
        });
    }

    // At the beginning of each round (preview), Pause should be inactive.
    setPauseButtonActive(false);
    // Main game: start is clickable immediately. Walkthrough: stage controls it.
    setStartButtonActive(!WALKTHROUGH_MODE);

    if (WALKTHROUGH_MODE && typeof window.introJs === 'function') {
        setWalkthroughStage('intro');
        setPauseButtonActive(false);
        const walkthroughSteps = [
            {
                intro: "Now, let's give you a quick walkthrough of the interface you will use in the target interception game."
            },
            {
                element: getVisibleElement('#gameCanvas'),
                intro: "This is the circular playfield. You'll see multiple targets with different urgency levels and shapes, and arrows showing the direction each one is moving. The human icon (red) shows where you are, and the robot icon (in this example, blue) shows where your AI teammate is. Whenever you need to select or update your target, you will see a glowing border around this field."
            },
            {
                element: getVisibleElement('#actionCard'),
                intro: "This is the action panel. Whenever there's some new instructions you should check and act upon in the game, they will appear here and you will see a glowing border around this panel."
            },
            {
                element: getVisibleElement('#scoreRuleCard'),
                intro: "This is the score panel. At any point during the game, you can check the team's points, your bonus points, and your AI teammate's bonus points here. Remember that your final score in a game is the sum of the team's points and your bonus points."
            },
            {
                element: getVisibleElement('#historyCard'),
                intro: "This is the history panel. It shows what each player has done over time - what target they chose, whether they caught it, and any updates they made to their choice."
            }
        ].filter(step => !step.element || !!step.element);

        window.setTimeout(() => {
            // Build the intro instance separately so we can attach handlers
            // without relying on every method returning `this` (chain shape
            // differs across intro.js versions on the CDN).
            const introInstance = window.introJs();
            introInstance.setOptions({
                steps: walkthroughSteps,
                showProgress: true,
                showBullets: false,
                // walkthrough-only: hide Back on the first step (intro.js
                // would otherwise show it disabled).
                hidePrev: true,
                nextLabel: 'Next',
                prevLabel: 'Back',
                doneLabel: 'Next'
            });

            // === walkthrough-only ===
            // Turn the playfield glow ON only while the playfield step is the
            // active intro.js step; turn it OFF for every other step. This is
            // the single place that ever sets walkthroughForceFieldGlow=true.
            if (typeof introInstance.onafterchange === 'function') {
                introInstance.onafterchange(function (targetElement) {
                    walkthroughForceFieldGlow = !!(targetElement && (targetElement.id === 'gameCanvas' || targetElement.id === 'gameContainer'));
                });
            }
            // === end walkthrough-only ===

            // walkthrough-only: shared handler so the prompt logic is in one place.
            const showStartGamePrompt = () => {
                walkthroughForceFieldGlow = false; // walkthrough-only: clear glow
                setWalkthroughStage('await_start_click');
                // Enable the Start button BEFORE showing the prompt so the
                // user can click it directly (auto-advances the overlay).
                if (gamePhase === 'preview' && !hasLoggedStartEvent) {
                    setStartButtonActive(true);
                }
                showWalkthroughInstruction(
                    "At the beginning of a game, you need to click the \"Start game\" button in the action panel to get the game started. Try clicking the \"Start game\" button now!",
                    '#continueButton',
                    'Next',
                    { autoAdvanceOnClick: true }
                );
            };

            introInstance.oncomplete(showStartGamePrompt);
            introInstance.onexit(showStartGamePrompt);

            introInstance.start();
        }, 350);
    }
});

// Function to stop the game - can be called from console or button
function stopGame() {
    if (gamePhase === 'animate') {
        isStopped = true;
        setPauseButtonActive(false);
        // Entering human pause-reselect: clear stale human selection visuals
        // so the user starts from a clean state with no old highlight/cross.
        clearPendingHumanSelectionVisuals();
        if (WALKTHROUGH_MODE && walkthroughStage === 'await_pause_click') {
            walkthroughRequiredTargetId = null;
            // Clear stale interception state before finishing tutorial steps.
            pendingAIReselectAfterHuman = null;
            walkthroughPostPausePending = false;
            const walkthroughPrevTargetLabel = player.targetObjID !== null && player.targetObjID !== undefined
                ? formatTargetLabelHtmlFromId(player.targetObjID)
                : 'none';
            const walkthroughPauseMsg = `You requested a pause of the game. Now, you can reselect in the field which target you want to catch. (Your target before the pause was ${walkthroughPrevTargetLabel})`;
            // Keep the reselect message visible in the action panel while the
            // walkthrough instruction is shown, without requiring extra OK clicks.
            $('#customAlertMessage').html(walkthroughPauseMsg);
            $('#customAlertConfirmButton').hide();
            $('#customAlertCancelButton').hide();
            $('#customAlertOkButton').hide();
            $('#customAlert').show();
            showWalkthroughInstruction("Once you pause the game, you will be asked to reselect your target in the field. If your AI teammate requests a pause, you will see information here about the AI's updated target selection (it will also be marked with a cross in the field, again, in the same color as the AI's icon).", '#actionCard', 'Next').then(() => {
                $('#customAlert').hide();
                // Tutorial-only behavior: after this explanation step, continue
                // directly to the final instructions (Step 16/17) without
                // requiring a reselection interaction.
                runWalkthroughPostPauseFinalSteps();
            });
            return;
        }
        const prevTargetLabel = player.targetObjID !== null && player.targetObjID !== undefined
            ? formatTargetLabelHtmlFromId(player.targetObjID)
            : 'none';
        const pauseMsg = `You requested a pause of the game. Now, you can reselect in the field which target you want to catch. (Your target before the pause was ${prevTargetLabel})`;
        showCustomAlert(pauseMsg, true).then(() => {
            startSelectionCycle('human', 'pause');
        });
    }
    console.log('Animation paused.');
    console.log('Current objects:', objects);
    console.log('Current player position:', {x: player.x, y: player.y});
    if (typeof AIplayer !== 'undefined') {
        console.log('Current AI player position:', {x: AIplayer.x, y: AIplayer.y});
    }
    // Make objects and player accessible globally for console inspection
    window.gameObjects = objects;
    window.gamePlayer = player;
    if (typeof AIplayer !== 'undefined') {
        window.gameAIplayer = AIplayer;
    }
}

// Make stopGame accessible globally for console
window.stopGame = stopGame;

window.debugGameState = function debugGameState() {
    const activeTargetCount = objects.filter((obj) => obj.active && !obj.intercepted).length;
    const humanTargetAlive = objects.some(
        (obj) => obj.ID === player.targetObjID && obj.active && !obj.intercepted
    );
    const aiTargetAlive = objects.some(
        (obj) => obj.ID === AIplayer.ID && obj.active && !obj.intercepted
    );
    return {
        gamePhase,
        isPaused,
        isStopped,
        playerMoving: player.moving,
        aiMoving: AIplayer.moving,
        playerTargetObjID: player.targetObjID,
        aiTargetObjID: AIplayer.ID,
        humanTargetAlive,
        aiTargetAlive,
        activeTargetCount,
        currentStartPreset
    };
};

// Function to resume the game after stop
function resumeGame() {
    isStopped = false;
    if (gamePhase === 'preview') {
        setPauseButtonActive(true);
        if (WALKTHROUGH_MODE) {
            const startInstructionPromise = showCustomAlert('The game has started. Select in the field which target you want to catch.');
            if (walkthroughStage === 'await_start_ok_then_target_9') {
                // Gate the next selection target right away so behavior is correct
                // even if the user closes the action-panel OK quickly.
                const recommendedTarget = pickClosestInterceptableTargetForWalkthrough();
                walkthroughRequiredTargetId = recommendedTarget ? recommendedTarget.ID : null;
                setWalkthroughStage('await_target_9');
                const instructionMsg = walkthroughRequiredTargetId !== null
                    ? `Once the game starts, you will receive an instruction in the action panel asking you to select a target in the field to catch.<br><br>For now, click the "OK" button in the action panel to acknowledge this instruction, and then select <strong>target ${walkthroughRequiredTargetId}</strong> in the field.`
                    : 'Once the game starts, you will receive an instruction in the action panel asking you to select a target in the field to catch.<br><br>For now, click the "OK" button in the action panel to acknowledge this instruction, and then select a target in the field.';
                showWalkthroughInstruction(
                    instructionMsg,
                    '#actionCard',
                    'Next',
                    { autoAdvanceOnClick: true, clickTargetSelector: '#customAlertOkButton' }
                );
            }
            startInstructionPromise.then(() => {
                startSelectionCycle('human', 'start');
            });
        } else {
            // Main game: no initial "OK" step; start selection immediately.
            startSelectionCycle('human', 'start');
        }
    }
    console.log('Reselection started.');
}

function setPauseButtonActive(isActive) {
    const stopButton = document.getElementById('stopButton');
    if (!stopButton) return;
    const isActionModalVisible =
        typeof window !== 'undefined' &&
        typeof window.$ === 'function' &&
        window.$('#customAlert').is(':visible');
    // Never allow Pause while action-panel modal is visible.
    stopButton.disabled = !isActive || isActionModalVisible;
}

function setStartButtonActive(isActive) {
    const startButton = document.getElementById('continueButton');
    if (!startButton) return;
    startButton.disabled = !isActive;
}

// Make resumeGame accessible globally for console
window.resumeGame = resumeGame;

async function runGameSequence(message) {
    isPaused = true;
    await showCustomAlert(message);
    isPaused = false;
}

// Function to check if the start game area is clicked

// Helper function to determine if the click is on the object
function isClickOnObject(obj, x, y) {
    // Objects are drawn with (obj.x, obj.y) as the center.
    const centerX = obj.x;
    const centerY = obj.y;

    // Calculate the distance between the click and the object's center
    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

    // Check if the distance is less than or equal to the cursor size
    return distance <= cursorSize;
}

// Helper function to determine if the click is on the center

//***************************************************** AI COMPARISON ***************************************************//



//**************************************************** SURVEY -- FULL ****************************************************//

//*************************************************** COMPLETE -- REDIRECT ************************************************//
