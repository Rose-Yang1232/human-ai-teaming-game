# Target Interception Game: Collaborative Intent in Human–AI Teaming

## Overview

AI systems are increasingly expected to work with people as teammates, rather than simply provide recommendations. Effective teamwork requires more than strong individual task performance: people also need to understand an AI teammate's objectives, constraints, and awareness of their own actions.

The Target Interception Game is a web-based research environment designed to study how people interpret an AI teammate's collaborative intent and coordinate with agents following different behavioral policies. It provides a controlled, dynamic task in which human and AI decisions are interdependent but each teammate can act independently.

Our central question is:

> **How do an AI teammate's behavioral policies and signals of collaborative intent influence human understanding, trust, coordination, and team performance?**

## Game Environment

In the game, a human player and an AI teammate work together to intercept moving targets. Targets vary in urgency and type, and the teammates have complementary areas of expertise. The task creates opportunities to cooperate, divide responsibilities, and navigate trade-offs between individual rewards and the shared team goal.

The dynamic environment makes the consequences of both teammates' choices observable: a target chosen by one teammate may also be valuable to the other, while delays or competing choices can change the team's opportunities.

The game is intended as an experimental testbed for studying human–AI coordination, rather than as a benchmark of interception speed alone.

## Research Design

The study examines three dimensions of AI teammate behavior and communication:

| Dimension | Core question |
| --- | --- |
| Constraint signaling | How does communicating the AI's behavioral constraints affect a human teammate's expectations and coordination? |
| Objective alignment signaling | How do signals about the AI's individual versus shared-team objectives shape perceptions of its collaborative intent? |
| Anticipatory awareness signaling | How does indicating awareness of the human teammate's likely actions affect coordination and trust? |

By systematically varying these dimensions, we aim to distinguish the effects of an agent's expressed intentions from the ways people interpret its behavior during collaboration.

## Outcomes of Interest

The planned evaluation focuses on:

- **Human understanding:** How accurately participants infer the AI teammate's collaborative intent and likely behavior.
- **Coordination:** How human and AI actions complement or conflict with each other during the task.
- **Team performance:** How effectively the team intercepts targets and balances individual versus shared goals.
- **Trust and teammate perceptions:** How participants evaluate the AI as a collaborator.

## Project Status

**Current stage:** Game environment completed; participant study in preparation.

The web-based target-interception environment has been developed, and the next step is to recruit participants for the first round of data collection. The research findings described above are questions to investigate, not results already established.

## Planned Next Steps

1. **Pilot and launch the first study.** Validate the participant experience and experimental conditions, then recruit participants to collect interaction and survey data.
2. **Analyze human–AI coordination.** Examine how the three signaling dimensions influence understanding, trust, behavioral responses, and task outcomes.
3. **Develop more adaptive AI planning.** Use insights from the first round of data to guide a subsequent planning algorithm that reasons about interception trajectories, target selection, and human–AI coordination.
4. **Evaluate improved agent policies.** Compare the adaptive planning approach with earlier agent behaviors to investigate whether better anticipation and intention alignment improve teamwork.

The roadmap is prospective and may evolve as the study progresses.

## Motivation

Our longer-term goal is to inform the design of AI agents that can make their intentions understandable and coordinate with people as genuine teammates, rather than optimize their own actions in isolation. Although this project uses a target-interception game, its underlying questions are relevant to interactive agents that collaborate with humans in research, planning, and other dynamic tasks.

## Running Locally

Requires Node 22.5 or newer; there is nothing to install.

```sh
node server/app.js
```

Then open <http://localhost:3000/index.html>.

## Acknowledgments

This project builds on the intercept-game codebase from MADLAB at UC Irvine (see `LICENSE`).

---

*Research project developed at Purdue University. Study results and additional documentation will be added as the work progresses.*
