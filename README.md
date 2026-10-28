# Signaling Collaborative Intent in Human–AI Teaming

**A target-interception testbed for studying how people understand and coordinate with AI teammates**

## Abstract

Artificial intelligence (AI), particularly with advanced Large Language Models (LLMs), is moving beyond being a simple decision-assistance tool to become an interdependent teammate in complex, multi-agent environments. As AI systems move from assisting users to acting alongside them, successful collaboration increasingly depends on whether people can understand agents' intentions. We present the **Target Interception Game**, a web-based research platform for investigating how AI teammates' observable behavior signals collaborative intent. A human and an AI teammate independently intercept moving targets with different urgencies and expertise specific bonuses, creating trade-offs between individual incentives and a shared team objective. The platform includes an algorithmic interception planner and eight agent conditions that vary three signaling dimensions: **constraint signaling**, **objective alignment signaling**, and **anticipatory awareness signaling**. Our ongoing study examines how these differences shape people's interpretations of AI intentions, trust, coordination strategies, and task performance. By connecting controlled agent policies with interaction records and participant responses, this research will establish a design framework for AI teammates that successfully align human preference with optimal team performance.

**Project status:** The game environment, experimental workflow, and baseline AI planning policies are implemented. The first participant study is collecting data; empirical findings and adaptive planning methods are future work.

## Start here: tutorial and game preview



**[Watch the game tutorial](images/yuwei_tutorial.mp4)** · **[Run a local demo](#try-it-locally)** · **[Explore the eight conditions](#preview-individual-agent-conditions)**

The tutorial introduces the target types, scoring rules, and turn-taking interaction. For a faster technical preview, reviewers with repository access can run the game locally.

## Research motivation

Independent action creates a need for mutual understanding. When a person and an AI contribute to the same task, the person must decide how to divide responsibilities, interpret the AI’s choices, and adjust their own actions. Those decisions depend on understanding what the AI is trying to achieve and whether its behavior supports their shared goal.

An agent’s internal objectives and decision process can be difficult for people to observe. People instead encounter signals through its actions and interface: which opportunities it pursues, what it leaves to the human, and how it responds to the human’s commitments.

The guiding research question is:

> How do constraint signaling, objective alignment signaling, and anticipatory awareness signaling shape people's understanding of an AI teammate's collaborative intent and the coordination that follows?

The broader research agenda considers both communication and behavior, including their alignment across interactions with one or multiple AI teammates. The current implementation focuses on a human working with one AI teammate and examines three signaling dimensions.

## Current study: three signaling dimensions

We study three dimensions of collaborative-intent signaling by independently varying aspects of an AI teammate's decision policy. Each addresses a different question a human collaborator might ask:

| Signaling dimension                     | Operationalization in the game                                                                                                                                        
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Constraint signaling**                |**No-harm:** Whether the AI avoids actions that could harm the human teammate's utility.                                      |
| **Objective alignment signaling**       |**Team-oriented:** Whether the AI prioritizes shared team outcomes over its individual rewards.                               |
| **Anticipatory awareness signaling**    |**Coordinating:** Whether the AI accounts for the human teammate's ongoing actions and choices.                               |


By linking these policy differences to interaction records and post-game responses, we aim to examine how people form judgments about an AI's intentions and how those judgments shape their trust and collaborative behavior. Outcomes of interest include perceived intent, trust and reliance, human target-selection behavior, individual scores, and team performance.

## The task

A human and an AI teammate select targets in a shared field. Targets move over time and differ in urgency; their shapes determine expertise-specific bonuses. After target selection, the simulation computes interception trajectories. Each teammate can act independently, but their choices affect one another’s opportunities and the team’s score.

The task combines a shared team goal, interdependent but independently executable actions, and a changing environment. It abstracts coordination challenges such as dividing work, anticipating another teammate’s commitment, and adapting when opportunities change.

The current study combines two levels of each policy factor into **eight agent conditions**. Participants retain the same assigned condition across two games with **5 and 15 concurrent targets**, with density order counterbalanced. The AI uses an algorithmic interception planner with configurable target-selection constraints, reward objectives, and coordination rules.

## Research roadmap

**Current study — signaling and human interpretation.** Examine how the three signaling dimensions shape people’s understanding of an AI teammate’s intentions, trust and reliance, and responses during collaboration. Connect these interpretations to observed choices and team outcomes to inform the collaborative-intent framework.

**Follow-up — modeling human responses.** After the first round of collection, model human target selection in the context of the agent’s behavior and the available task opportunities. This extension will investigate how behavioral patterns can inform agents that adapt to their human teammates. Prediction models will use information available at decision time and be evaluated on held-out participants.

The game provides a controlled setting for studying the relationship between an AI’s expressed collaborative intent, human interpretations, and the teamwork that follows. Findings will inform broader questions about how independently acting AI agents can become understandable and effective teammates.

## Try it locally

Reviewers can run a local copy to explore the task and AI behaviors. Use **Node.js 22.13 or newer** and a modern desktop browser. Some interface assets load from public CDNs, so internet access is needed for the full interface.

```sh
git clone https://github.com/Rose-Yang1232/human-ai-teaming-game.git
cd human-ai-teaming-game
HOST=127.0.0.1 node server/app.js
```

Open **[http://localhost:3000/index.html](http://localhost:3000/index.html)** and follow the instructions to try the game.

Your instance serves the game and API locally and saves demo interactions to `data/experiment.db` on your machine. With the supplied configuration, it does not connect to the research deployment or upload gameplay to the lab. Databases and exports are ignored by Git.

The server may warn that a Prolific completion code is unset. You can still try the game; returning to a recruited study on Prolific requires that study’s own configuration.

## Code and verification

| Path                                                               | Purpose                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [`index.html`](index.html), [`html/`](html/)                       | Participant workflow, game pages, and surveys.                    |
| [`js/new-interface-all-agents.js`](js/new-interface-all-agents.js) | Game engine and agent-policy integration.                         |
| [`js/AIplannerv1.5.2.js`](js/AIplannerv1.5.2.js)                   | Target-interception planner.                                      |
| [`js/interaction-recorder.js`](js/interaction-recorder.js)         | Board snapshots, interaction events, and human decision tracking. |
                                                
