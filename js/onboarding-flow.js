/*
onboarding-flow.js

Linear onboarding flow for welcome -> consent -> tutorial -> walkthrough
-> experiment launch -> assessment placeholder -> final message.
*/

(function () {
    const STEP_CONFIG = {
        welcome: {
            title: "",
            template: "html/welcome-page.html"
        },
        consent: {
            title: "",
            template: "html/consent-lite.html"
        },
        tutorialRules: {
            title: "",
            template: "html/tutorial-rules.html"
        },
        walkthrough: {
            title: "",
            template: "html/walkthrough.html"
        },
        experiment: {
            title: "Experiment",
            template: "html/experiment-sessions.html"
        },
        assessment: {
            title: "Post Survey",
            template: "html/assessment-placeholder.html"
        },
        final: {
            title: "Complete",
            template: "html/final-message.html"
        }
    };

    function hideAllContainers() {
        $("#consent-header, #instructions-header, #comprehension-quiz-header, #exp-survey-header, #exp-complete-header").attr("hidden", true);
        $("#consent-main-content, #instructions-main-content, #comprehension-quiz-main-content, #survey-main-content, #task-complete").attr("hidden", true);
    }

    function updateTaskHeader(title) {
        if (!title) {
            $("#task-header").text("");
            $("#task-header").attr("hidden", true);
            return;
        }
        $("#task-header").text(title);
        $("#task-header").attr("hidden", false);
    }

    function goToStep(stepKey) {
        const step = STEP_CONFIG[stepKey];
        if (!step) return;

        hideAllContainers();
        updateTaskHeader(step.title);
        $("#task-main-content").attr("hidden", false);

        const templatePath = step.template + "?v=" + Date.now();
        $("#task-main-content").load(templatePath, function (_response, status) {
            if (status === "error") {
                $("#task-main-content").html(
                    "<div class='flow-card'><h3>Page failed to load</h3><p>Please refresh and try again.</p></div>"
                );
                return;
            }
            bindStepEvents(stepKey);
        });
    }

    function bindStepEvents(stepKey) {
        if (stepKey === "welcome") {
            $("#welcome-continue").off("click").on("click", function () {
                goToStep("consent");
            });
            return;
        }

        if (stepKey === "consent") {
            const consentCheckbox = $("#consent-lite-checkbox");
            const consentButton = $("#consent-lite-continue");
            consentCheckbox.off("change").on("change", function () {
                consentButton.prop("disabled", !this.checked);
            });
            const consentShownAt = Date.now();
            consentButton.off("click").on("click", async function () {
                consentButton.prop("disabled", true);
                try {
                    // The consent record needs the participant ID, so wait for
                    // the landing-page start and for the record itself.
                    await window.ExperimentAPI.startStudy();
                    const saved = await window.ExperimentAPI.logStudyEvent("consent", {
                        agreed: true,
                        form: "consent-lite",
                        timeOnPageMs: Date.now() - consentShownAt
                    });
                    if (!saved) throw Error("Your consent could not be recorded. Check your connection and click Continue again.");
                } catch (error) {
                    window.ExperimentAPI.showStudyError(error);
                    consentButton.prop("disabled", !consentCheckbox.prop("checked"));
                    return;
                }
                goToStep("tutorialRules");
            });
            $("#consent-lite-back").off("click").on("click", function () {
                goToStep("welcome");
            });
            return;
        }

        if (stepKey === "tutorialRules") {
            const rulesScroll = document.querySelector(".tutorial-rules-scroll");
            if (rulesScroll) {
                rulesScroll.scrollTop = 0;
            }
            $("#tutorial-rules-next").off("click").on("click", function () {
                goToStep("walkthrough");
            });
            return;
        }

        if (stepKey === "walkthrough") {
            $("#walkthrough-back").off("click").on("click", function () {
                goToStep("tutorialRules");
            });
            $("#walkthrough-launch").off("click").on("click", function () {
                window.location.assign(window.ExperimentAPI.withParticipant("html/walkthrough-game.html?debug=true&collab=1&session=1"));
            });
            return;
        }

        if (stepKey === "experiment") {
            const session1Path = "html/game-main-exp.html?debug=true&collab=1&session=1";
            const session2Path = "html/game-main-exp.html?debug=true&collab=1&session=2";
            $("#session-1-open").attr("href", session1Path);
            $("#session-2-open").attr("href", session2Path);

            $("#experiment-back").off("click").on("click", function () {
                goToStep("walkthrough");
            });
            $("#experiment-next").off("click").on("click", function () {
                goToStep("assessment");
            });
            return;
        }

        if (stepKey === "assessment") {
            const requiredGroups = [
                "post-q01", "post-q02", "post-q03", "post-q04",
                "post-q05", "post-q06", "post-q07", "post-q08"
            ];
            const nextBtn = $("#assessment-next");
            const updateAssessmentCompletion = function () {
                const allAnswered = requiredGroups.every(function (groupName) {
                    return document.querySelector("input[name='" + groupName + "']:checked");
                });
                nextBtn.prop("disabled", !allAnswered);
            };

            $("input[name^='post-q']").off("change").on("change", updateAssessmentCompletion);
            updateAssessmentCompletion();

            $("#assessment-back").off("click").on("click", function () {
                goToStep("experiment");
            });
            $("#assessment-next").off("click").on("click", function () {
                goToStep("final");
            });
            return;
        }

        if (stepKey === "final") {
            $("#final-restart").off("click").on("click", function () {
                goToStep("welcome");
            });
        }
    }

    $(document).ready(function () {
        // Record the Prolific IDs as soon as the study link opens.
        window.ExperimentAPI.startStudy().catch(function (error) {
            window.ExperimentAPI.showStudyError(error);
        });
        // The game needs a mouse and an 800-pixel board. Prolific's device filter
        // should already exclude phones and tablets; this catches anyone it misses.
        const touchOnly = window.matchMedia("(pointer: coarse)").matches &&
            !window.matchMedia("(any-pointer: fine)").matches;
        if (touchOnly || window.screen.width < 900) {
            $("#task-main-content").attr("hidden", false).html(
                "<div class='flow-card'><h3>Please use a desktop or laptop computer</h3>" +
                "<p>This study needs a mouse and a larger screen. Please return the study on Prolific " +
                "or reopen your study link on a computer.</p></div>");
            return;
        }
        goToStep("welcome");
    });
})();
