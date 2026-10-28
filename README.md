# Signaling Collaborative Intent in Human–AI Teaming

**A target-interception testbed for studying how people understand and coordinate with AI teammates**

## Abstract

As AI systems move from assisting users to acting alongside them, successful collaboration increasingly depends on whether people can interpret an agent's intentions. We present the **Target Interception Game**, a web-based research platform for investigating how AI teammates' observable behavior signals collaborative intent. A human and an AI teammate independently intercept moving targets with different urgencies and expertise-specific bonuses, creating trade-offs between individual incentives and a shared team objective. The platform includes an algorithmic interception planner and eight agent conditions that vary three signaling dimensions: **constraint signaling**, **objective alignment signaling**, and **anticipatory awareness signaling**. Our ongoing study examines how these differences shape people's interpretations of AI intentions, trust, coordination strategies, and task performance. By connecting controlled agent policies with interaction records and participant responses, this research aims to inform the design of AI teammates whose behavior is understandable and supports effective human–AI coordination.

**Project status:** The game environment, experimental workflow, and baseline AI planning policies are implemented. The first participant study is collecting data; empirical findings and adaptive planning methods are future work.

## Start here: tutorial and game preview



**[Watch the game tutorial](images/yuwei_tutorial.mp4)** · **[Run a local demo](#try-it-locally)** · **[Explore the eight conditions](#preview-individual-agent-conditions)**

The tutorial introduces the target types, scoring rules, and turn-taking interaction. For a faster technical preview, reviewers with repository access can run the game locally and select a condition directly; the live participant study does not need to be used as a demo.

## Research motivation

Independent action creates a need for mutual understanding. When a person and an AI contribute to the same task, the person must decide how to divide responsibilities, interpret the AI’s choices, and adjust their own actions. Those decisions depend on understanding what the AI is trying to achieve and whether its behavior supports their shared goal.

An agent’s internal objectives and decision process can be difficult for people to observe. People instead encounter signals through its actions and interface: which opportunities it pursues, what it leaves to the human, and how it responds to the human’s commitments. Understanding how people interpret these signals is essential to designing AI teammates whose collaborative intent is understandable in practice.

**Collaborative intent** concerns how an agent's goals, constraints, and consideration of its teammate guide its actions in a shared task. We investigate how people infer these properties from observable decisions and interface feedback, including when individual and team incentives conflict.

The guiding research question is:

> How do constraint signaling, objective alignment signaling, and anticipatory awareness signaling shape people's understanding of an AI teammate's collaborative intent—and the coordination that follows?

The broader research agenda considers both communication and behavior, including their alignment across interactions with one or multiple AI teammates. The current implementation focuses on a human working with one AI teammate and examines three signaling dimensions.

## Current study: three signaling dimensions

We study three dimensions of collaborative-intent signaling by independently varying aspects of an AI teammate's decision policy. Each addresses a different question a human collaborator might ask:

| Signaling dimension                     | Question                                     | Operationalization in the game                                                                                                                                        |
| --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Constraint signaling**                | *What is the AI willing or unwilling to do?* | **No-harm:** the AI avoids square targets, which provide a human-specific bonus. **May-harm:** those targets remain eligible.                                         |
| **Objective alignment signaling**       | *Whose outcomes guide the AI's choices?*     | **Team-oriented:** targets are valued by their contribution to the shared team score. **Individually oriented:** the AI also values its own expertise-specific bonus. |
| **Anticipatory awareness signaling**    | *Does the AI account for what I am doing?*   | **Coordinating:** the AI avoids the human's selected target and the human's region of the field. **Oblivious:** these human-specific exclusions are not applied.      |

These signaling dimensions are conceptually distinct. An agent can pursue the team objective without accounting for the human's current choice; similarly, an agent can avoid interfering with the human while still valuing its own rewards. The **no-harm** label denotes the specific restriction on square targets in this task, not a general guarantee that the AI cannot negatively affect its teammate.

Here, *signaling* refers to the information people can infer from the agent's observable actions and interface feedback. The three dimensions are implemented as policy variations; whether and how people interpret the resulting behavior as signals of collaborative intent is what the study investigates. Explicit language-based communication of intent, and the alignment between stated intent and behavior, are part of the broader research agenda rather than separate factors in this eight-condition study.

By linking these policy differences to interaction records and post-game responses, we aim to examine how people form judgments about an AI's intentions and how those judgments shape their trust and collaborative behavior. Outcomes of interest include perceived intent, trust and reliance, human target-selection behavior, individual scores, and team performance.

## The task

A human and an AI teammate select targets in a shared field. Targets move over time and differ in urgency; their shapes determine expertise-specific bonuses. After target selection, the simulation computes interception trajectories. Each teammate can act independently, but their choices affect one another’s opportunities and the team’s score.

The task combines a shared team goal, interdependent but independently executable actions, and a changing environment. It abstracts coordination challenges such as dividing work, anticipating another teammate’s commitment, and adapting when opportunities change.

For example, an AI can pursue a target that benefits its own score, leave a target better suited to the human, or select a complementary target to avoid competing for the same opportunity. These choices make the trade-offs between individual incentives and collective success visible to the human teammate.

The current study combines two levels of each policy factor into **eight agent conditions**. Participants retain the same assigned condition across two games with **5 and 15 concurrent targets**, with density order counterbalanced. The AI uses an algorithmic interception planner with configurable target-selection constraints, reward objectives, and coordination rules.

## Platform capabilities

- **Complete participant workflow:** consent, interactive instructions, practice, qualification, two experimental games, post-game surveys, and completion handling.
- **Configurable AI policies:** target filtering, interception planning, and replanning under different constraints, objectives, and awareness settings.
- **Persistent experimental assignments:** server-side condition assignment and target-density ordering, retained across games and page reloads.
- **Detailed behavioral records:** human proposals, cancellations, confirmed choices, AI selections, response timing, scores, and interface history.
- **Decision-start snapshots:** board state and available target alternatives recorded before each human choice, supporting future prediction without using information revealed by the choice itself.
- **Local data infrastructure:** a Node.js server, SQLite storage, and CSV/JSON export tools, with no npm dependencies.

## Research roadmap

**Current study — signaling and human interpretation.** Examine how the three signaling dimensions shape people’s understanding of an AI teammate’s intentions, trust and reliance, and responses during collaboration. Connect these interpretations to observed choices and team outcomes to inform the collaborative-intent framework.

**Follow-up — modeling human responses.** After the first round of collection, model human target selection in the context of the agent’s behavior and the available task opportunities. This extension will investigate how behavioral patterns can inform agents that adapt to their human teammates. Prediction models will use information available at decision time and be evaluated on held-out participants.

**Future evaluation — adaptive AI teammates.** Use insights from the study and human-choice models to develop agents that adapt their actions while making their collaborative intent understandable. Evaluate these agents in terms of human understanding, trust, collaborative behavior, and team performance.

Human-choice prediction and learned coordination policies are planned work. The current awareness policies use observable human commitments and spatial rules. Study findings will be added as the research progresses.

The game provides a controlled setting for studying the relationship between an AI’s expressed collaborative intent, human interpretations, and the teamwork that follows. Findings will inform broader questions about how independently acting AI agents can become understandable and effective teammates.

## Try it locally

Reviewers who have been granted access to this **private repository** can run a local copy to explore the task and AI behaviors. Use **Node.js 22.13 or newer** and a modern desktop browser. Some interface assets load from public CDNs, so internet access is needed for the full interface.

```sh
git clone https://github.com/Rose-Yang1232/human-ai-teaming-game.git
cd human-ai-teaming-game
HOST=127.0.0.1 node server/app.js
```

Open **[http://localhost:3000/index.html](http://localhost:3000/index.html)** and follow the instructions to try the game. No package installation, external database, lab account, or recruitment credentials are required; cloning the private repository does require GitHub access.

Your instance serves the game and API locally and saves demo interactions to `data/experiment.db` on your machine. With the supplied configuration, it does not connect to the research deployment or upload gameplay to the lab. Databases and exports are ignored by Git.

The server may warn that a Prolific completion code is unset. You can still try the game; returning to a recruited study on Prolific requires that study’s own configuration.

To use another port:

```sh
HOST=127.0.0.1 PORT=3001 node server/app.js
```

Then open [http://localhost:3001/index.html](http://localhost:3001/index.html). See [the server documentation](server/README.md) for storage schemas and configuration.

### Preview individual agent conditions

For local testing, the assignment service accepts a requested condition for a **new test participant**. After starting the server, open:

```text
http://localhost:3000/html/game-main-exp.html?session=1&newParticipant=1&condition=1
```

Change `condition=1` to a number from **1** through **8** to explore the full 2 × 2 × 2 design. The condition numbers correspond to the combinations below:

| Condition | Constraint | Objective  | Awareness    |
| --------- | ---------- | ---------- | ------------ |
| 1         | May-harm   | Individual | Oblivious    |
| 2         | May-harm   | Individual | Coordinating |
| 3         | May-harm   | Team       | Oblivious    |
| 4         | May-harm   | Team       | Coordinating |
| 5         | No-harm    | Individual | Oblivious    |
| 6         | No-harm    | Individual | Coordinating |
| 7         | No-harm    | Team       | Oblivious    |
| 8         | No-harm    | Team       | Coordinating |

Use a fresh test link for each condition: once a participant ID has been assigned, the same ID retains its original condition. These links are **local experimenter previews**, not public hosted demos. Local previews use the same study logic and will produce local test records, so they should not be run against the production participant database. This is an experimental research platform; no public study results are claimed here.

## Code and verification

| Path                                                               | Purpose                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [`index.html`](index.html), [`html/`](html/)                       | Participant workflow, game pages, and surveys.                    |
| [`js/new-interface-all-agents.js`](js/new-interface-all-agents.js) | Game engine and agent-policy integration.                         |
| [`js/AIplannerv1.5.2.js`](js/AIplannerv1.5.2.js)                   | Target-interception planner.                                      |
| [`js/interaction-recorder.js`](js/interaction-recorder.js)         | Board snapshots, interaction events, and human decision tracking. |
| [`js/api-client.js`](js/api-client.js)                             | Local API access and participant identity handling.               |
| [`server/`](server/)                                               | HTTP server, assignment logic, SQLite storage, and exports.       |
| [`tests/`](tests/)                                                 | Planner, assignment, decision-recording, and storage checks.      |

Run the existing checks from the repository root:

```sh
node tests/conditions/run.mjs
node tests/conditions/replan.mjs
node tests/storage/assignments.mjs
node tests/storage/decisions.mjs
node tests/storage/run.mjs
node tests/storage/http.mjs
```

Storage checks use disposable databases; the HTTP check starts a temporary local server. The [planner checks](tests/conditions/README.md) generate an inspection report and document their coverage. Full participant-flow verification also requires browser testing.

## Data and reuse

This repository provides the application source and study materials. Participant datasets, production credentials, and the research deployment’s address are not included. Local demo records stay on the machine running the server. Keep databases, exports, identifiers, and deployment settings out of version control.

Researchers adapting the platform should configure their own study materials, recruitment integration, and deployment access controls.

## Acknowledgments and license

Developed for human–AI teaming research at **Purdue University**, building on the target-interception game from **MADLAB at UC Irvine**. The current adaptation includes the collaborative-intent study workflow, configurable agent behaviors, decision instrumentation, and study data infrastructure.

See [LICENSE](LICENSE) for the upstream MIT license, copyright © 2025 MADLAB at UC Irvine. Preserve the upstream license and attribution when reusing the code; check the reuse terms of included institutional logos and media separately.
