# Looper

Looper is a runtime for repeatedly invoking an agent against a prompt until a stop condition ends the run.

## Language

**Looper**:
A runtime that executes iterative runs against an agent until a stop condition is reached.
_Avoid_: CLI wrapper, agent spawner

**Looper v1**:
The legacy major version of Looper built around spawning local AI CLIs.
_Avoid_: classic Looper, old runtime

**Looper v2**:
The next major version of Looper in the same repo and package, built as a fully ACP-native runtime.
_Avoid_: fork, new product, driver-agnostic runtime

**ACP-native**:
Looper's public interface is defined directly around ACP concepts rather than a generic driver abstraction.
_Avoid_: multi-protocol by default, driver-based UX

**Agent**:
The primary execution target selected by a Looper user in v2.
_Avoid_: client, runtime

**Fresh session**:
A **Run** mode where each loop iteration starts a new ACP session with no carried conversational state from prior iterations.
_Avoid_: persistent session, continued chat

**Stop condition**:
The Looper-level rule that decides whether the loop ends after an iteration.
_Avoid_: transport shutdown, session close

**Sentinel**:
The canonical **Stop condition** signal emitted in assistant text to tell Looper to end the loop. The default value is `:::LOOPER_DONE:::`.
_Avoid_: session close, graceful exit, tool output

**Assistant text**:
Text authored by the agent itself, not tool output or transport errors.
_Avoid_: transcript text, tool result text

**Agent id**:
The canonical ACP identifier a Looper user provides to select which Agent to run.
_Avoid_: raw command, executable path

**Configured Agent**:
The Agent stored in Looper configuration and used when a run does not specify an Agent id.
_Avoid_: bundled agent, implicit runtime

**Agent override**:
An explicit Agent id supplied at run time to replace the configured **Configured Agent** for that run.
_Avoid_: required agent flag, hidden fallback

**Agent listing**:
A UX that shows available Agents so a user can choose or copy an **Agent id**.
_Avoid_: hidden registry, undocumented ids

**Agent metadata**:
Human-usable information shown in an **Agent listing**, such as display name, status, and capabilities.
_Avoid_: opaque id-only output

**Agent status**:
The current availability state of an Agent as shown in an **Agent listing**.
_Avoid_: assumed availability

**Preflight validation**:
The checks Looper performs before iteration 1 to ensure a run is executable.
_Avoid_: best-effort start, late failure

**Resume history**:
The persisted record of **Resume override** changes applied within the same run.
_Avoid_: hidden run mutation

**Resume listing**:
The summary view Looper shows for **Non-complete runs** when `looper resume` is called without an id.
_Avoid_: id-only chooser

**Run inspection**:
A detailed view of one run, including persisted context and **Resume history**.
_Avoid_: listing-only visibility

**Non-complete run**:
A run that ended without reaching a clean terminal outcome and is eligible for **Resume**.
_Avoid_: finished run, completed loop

**Complete run**:
A run that ended by sentinel completion or max-iterations completion and is not eligible for **Resume**.
_Avoid_: interrupted run, failed run

**Capability summary**:
A simple human-readable description of what an Agent supports, shown by default in an **Agent listing**.
_Avoid_: raw protocol dump

**JSON agent listing**:
A machine-readable view of an **Agent listing** that exposes detailed ACP metadata.
_Avoid_: human-only output

**Interactive init**:
An init flow that lets a TTY user choose the configured `agent` from an **Agent listing**.
_Avoid_: edit-config-only setup

**Non-interactive init**:
An init flow that skips interactive agent selection and relies on an explicit `--agent` or later config editing.
_Avoid_: forced prompt UI

**Run**:
The top-level Looper execution record that can be resumed or inspected.
_Avoid_: session, ACP session

**Resume**:
A Looper feature that continues a **Non-complete run** from the next iteration while preserving fresh-session semantics.
_Avoid_: conversation continuation, persistent ACP session

**Resume override**:
An explicit Agent id or model supplied during **Resume** to continue the run with a different execution target.
_Avoid_: immutable resume definition, prompt rewrite

**Resolved prompt**:
The full prompt body stored by Looper for a run after input collection, regardless of whether it came from a file, inline text, or stdin.
_Avoid_: source-only reference, stdin-only prompt

**Model override**:
An optional model selection supplied for a run that must be supported by the selected Agent.
_Avoid_: guaranteed model support, silent ignore

**AFK-safe**:
A Looper run mode where the selected Agent must execute unattended without interactive permission requests.
_Avoid_: approval pause, permission prompt

**Compatible Agent**:
An Agent that is **AFK-safe**.
_Avoid_: listed-only agent, feature-complete agent

**Incompatible Agent**:
An Agent visible in discovery that is not **AFK-safe**.
_Avoid_: runnable agent

**Init picker**:
The agent-selection UI used during **Interactive init**.
_Avoid_: unrestricted chooser

## Relationships

- **Looper v2** succeeds **Looper v1**
- **Looper v1** and **Looper v2** are major versions of **Looper**, not separate products
- **Looper v2** is **ACP-native** and does not expose protocol selection in its public surface
- A **Run** is the top-level Looper artifact
- A **Fresh session** is an ACP session within a **Run** iteration
- A **Looper** user selects an **Agent** to execute each run
- An **Agent** is selected by its **Agent id**
- A **Configured Agent** may be set in Looper configuration and used when no **Agent id** is provided at run time
- An **Agent override** replaces the **Configured Agent** for a single run
- A **Resume override** does not change the **Configured Agent**
- An **Agent listing** helps users discover and copy valid **Agent ids**
- An **Agent listing** includes **Agent metadata** for human selection and copy/paste
- **Agent metadata** includes **Agent status**
- A default **Agent listing** shows a **Capability summary** rather than raw protocol details
- A **JSON agent listing** exposes detailed ACP metadata when needed
- **Interactive init** uses an **Init picker** backed by an **Agent listing** to set the configured `agent`
- The **Init picker** allows only **Compatible Agents** to be selected
- **Non-interactive init** skips agent selection unless an explicit `--agent` is supplied
- **Non-interactive init** fails if the explicit `--agent` is an **Incompatible Agent**
- **Looper run** performs **Preflight validation** before starting execution
- **Preflight validation** re-checks agent compatibility at run time
- A standard **Looper v2** run uses a **Fresh session** for each iteration
- **Resume** continues the loop from the next iteration rather than restoring a live ACP conversation
- A **Non-complete run** is eligible for **Resume**
- A **Complete run** is not eligible for **Resume**
- `looper resume` without an id shows a **Resume listing** of **Non-complete runs**
- A **Resume listing** includes run id, started time, stop reason, effective Agent, and iteration progress
- A **Resume listing** indicates when **Resume history** changed the Agent or model within a run
- **Run inspection** exposes persisted context and full **Resume history** for a selected run
- A **Resolved prompt** is stored for each run and reused by **Resume**
- A **Resume override** may replace the original Agent or model for the resumed portion of a run
- A **Resume override** does not change the prompt, sentinel, max iterations, or vars
- **Resume history** records when Agent or model changes occurred within the same run
- Agent switching within a run happens only through explicit **Resume override**
- A **Model override** applies only when the selected **Agent** supports it
- Unsupported **Model override** values fail with an explicit error
- Standard **Looper v2** runs are **AFK-safe**
- Agents that require interactive permission requests are **Incompatible Agents** for standard **Looper v2** runs
- **Agent listings** include both **Compatible Agents** and **Incompatible Agents**
- **Agent listings** include unavailable agents and expose their **Agent status**
- **Agent listings** are sorted in this order: compatible+available, compatible+unavailable, incompatible+available, incompatible+unavailable
- Compatibility depends only on whether an **Agent** is **AFK-safe**
- A **Sentinel** is the canonical **Stop condition** for ending a **Looper** run
- A **Sentinel** only counts when it appears in **Assistant text**
- ACP session shutdown is separate from the **Stop condition**

## Example dialogue

> **Dev:** "Is **Looper v2** a new product?"
> **Domain expert:** "No — it's the next major version of **Looper** in the same repo/package."
>
> **Dev:** "What's the difference between a run and a session?"
> **Domain expert:** "A **Run** is the top-level Looper record; a session is the per-iteration ACP conversation."
>
> **Dev:** "What do I choose when I start a run?"
> **Domain expert:** "You choose an **Agent**, not a CLI or a driver."
>
> **Dev:** "Does the next iteration continue the same conversation?"
> **Domain expert:** "No — each iteration starts a **Fresh session**."
>
> **Dev:** "If the ACP session ends cleanly, is the loop done?"
> **Domain expert:** "Not by itself — the **Sentinel** is the **Stop condition**; session shutdown is separate."
>
> **Dev:** "Did v2 change the default sentinel?"
> **Domain expert:** "No — the default **Sentinel** remains `:::LOOPER_DONE:::`."
>
> **Dev:** "What if a tool prints the sentinel?"
> **Domain expert:** "That does not count — only **Assistant text** can trigger the **Sentinel**."
>
> **Dev:** "How do I choose what runs?"
> **Domain expert:** "You provide the **Agent id** for the **Agent** you want Looper to run."
>
> **Dev:** "What if I usually use the same agent?"
> **Domain expert:** "Set the configured `agent` during init, then override it with an **Agent id** when needed."
>
> **Dev:** "Do I have to pass an agent every run?"
> **Domain expert:** "No — Looper falls back to the configured `agent` unless you provide an **Agent override**."
>
> **Dev:** "If I resume with another agent, does that rewrite the config?"
> **Domain expert:** "No — a **Resume override** does not change the configured `agent`."
>
> **Dev:** "How does init pick the agent?"
> **Domain expert:** "TTY users get **Interactive init**; non-interactive environments use **Non-interactive init**."
>
> **Dev:** "What does the agent list show?"
> **Domain expert:** "It shows the **Agent id** plus **Agent metadata** like display name, status, and capabilities."
>
> **Dev:** "How are capabilities shown by default?"
> **Domain expert:** "As a simple **Capability summary**, not a raw protocol dump."
>
> **Dev:** "What if I want the raw details?"
> **Domain expert:** "Use a **JSON agent listing** to inspect the detailed ACP metadata."
>
> **Dev:** "What happens when I resume an interrupted run?"
> **Domain expert:** "**Resume** starts again at the next iteration, and each resumed iteration still uses a **Fresh session**."
>
> **Dev:** "What if I hit my limit on one agent?"
> **Domain expert:** "Use a **Resume override** to continue the interrupted run with a different Agent or model."
>
> **Dev:** "Can resume change the prompt too?"
> **Domain expert:** "No — a **Resume override** changes only the Agent or model, not the prompt or other run inputs."
>
> **Dev:** "How do I know when a resumed run switched agents?"
> **Domain expert:** "Looper persists **Resume history** so the Agent/model changes are visible in the same run record."
>
> **Dev:** "Will Looper automatically fail over to another agent?"
> **Domain expert:** "No — agent switching happens only through explicit **Resume override**."
>
> **Dev:** "Which runs can I resume?"
> **Domain expert:** "Any **Non-complete run** can be resumed; **Complete runs** cannot."
>
> **Dev:** "What counts as complete?"
> **Domain expert:** "Sentinel completion and max-iterations completion."
>
> **Dev:** "What does `looper resume` show with no id?"
> **Domain expert:** "It shows a **Resume listing** of all **Non-complete runs**."
>
> **Dev:** "What information is in that listing?"
> **Domain expert:** "Enough to choose intelligently: run id, started time, stop reason, effective Agent, and iteration progress."
>
> **Dev:** "How does the listing show agent switches?"
> **Domain expert:** "It shows the effective Agent and indicates when **Resume history** changed the Agent or model."
>
> **Dev:** "How do I see the full history of one run?"
> **Domain expert:** "Use **Run inspection** to see the persisted context and full **Resume history**."
>
> **Dev:** "What if my prompt came from stdin?"
> **Domain expert:** "That is still resumable because Looper stores the **Resolved prompt** for every run."
>
> **Dev:** "What if I pass a model the agent doesn't support?"
> **Domain expert:** "Looper fails with an explicit error instead of silently ignoring the **Model override**."
>
> **Dev:** "Can an agent pause and ask me for permission during a run?"
> **Domain expert:** "No — standard **Looper v2** runs are **AFK-safe** and must not require interactive permission requests."
>
> **Dev:** "Should incompatible agents be hidden from discovery?"
> **Domain expert:** "No — Looper still lists them, but shows **Compatible Agents** first."
>
> **Dev:** "Does compatibility depend on tools or model support too?"
> **Domain expert:** "No — compatibility only means the **Agent** is **AFK-safe**."
>
> **Dev:** "Can init set an incompatible agent as the default?"
> **Domain expert:** "No — the **Init picker** only allows **Compatible Agents**."
>
> **Dev:** "What if non-interactive init is given an incompatible `--agent`?"
> **Domain expert:** "It fails rather than writing an unusable configured `agent`."
>
> **Dev:** "Does Looper trust the old config forever once init succeeds?"
> **Domain expert:** "No — **Looper run** re-checks compatibility at run time before execution."
>
> **Dev:** "Should unavailable agents disappear from listings?"
> **Domain expert:** "No — Looper still shows them and marks their **Agent status** clearly."
>
> **Dev:** "How are agents ordered in the listing?"
> **Domain expert:** "Looper shows compatible+available first, then compatible+unavailable, then incompatible+available, then incompatible+unavailable."
>
> **Dev:** "When does Looper reject a bad run configuration?"
> **Domain expert:** "During **Preflight validation**, before iteration 1 starts."

## Flagged ambiguities

- "v2" was used to mean either a new product or a new major version — resolved: it is a new major version of **Looper**, not a separate product.
- "protocol-native" could have meant a generic multi-protocol driver model — resolved: **Looper v2** is fully **ACP-native** and does not expose `--driver`.
- "session" could have meant either the top-level Looper artifact or the ACP conversation — resolved: **Run** is the top-level artifact and **Fresh session** refers to the per-iteration ACP session.
- "done" could have meant either loop completion or transport/session termination — resolved: **Sentinel** controls loop completion; ACP shutdown is a separate concern.
- "sentinel default" could have changed with v2 — resolved: the default **Sentinel** remains `:::LOOPER_DONE:::`.
- "output" could have meant any transcript text — resolved: only **Assistant text** can trigger the **Sentinel**.
- "agent selection" could have meant a local executable reference — resolved: users select an **Agent** by **Agent id**.
- "agent discovery" could have been entirely out of scope — resolved: Looper provides an **Agent listing** and supports a configured `agent`.
- "agent selection" could have required an explicit flag on every run — resolved: Looper falls back to the configured `agent` and supports an **Agent override**.
- "resume override" could have implied config mutation — resolved: it does not change the configured `agent`.
- "init" could have assumed an interactive terminal — resolved: Looper supports both **Interactive init** and **Non-interactive init**.
- "agent listing" could have been id-only — resolved: it includes **Agent metadata** such as display name, status, and capabilities.
- "capabilities" could have meant raw protocol data by default — resolved: the default listing shows a simple **Capability summary**.
- "agent listing" could have been human-only — resolved: a **JSON agent listing** is also available for detailed ACP metadata.
- "resume" could have implied restoring an ACP conversation — resolved: **Resume** continues the loop from the next iteration with **Fresh session** semantics.
- "resume" could have implied a fully immutable run definition — resolved: **Resume override** may change the Agent or model for the resumed portion of a run.
- "resume override" could have implied broader run mutation — resolved: it only changes Agent or model.
- "resume override" could have been invisible in persisted state — resolved: Looper stores **Resume history** in the same run record.
- "agent switching" could have been automatic — resolved: it happens only through explicit **Resume override**.
- "resumable" could have meant only interrupted runs — resolved: any **Non-complete run** is eligible for **Resume**.
- "complete" could have been loosely defined — resolved: only sentinel completion and max-iterations completion are **Complete runs**.
- "resume listing" could have remained interrupted-only — resolved: `looper resume` without an id lists **Non-complete runs**.
- "resume listing" could have been too sparse to use well — resolved: it includes run id, started time, stop reason, effective Agent, and iteration progress.
- "resume listing" could have hidden agent changes — resolved: it indicates when **Resume history** changed the Agent or model.
- "detailed run visibility" could have been missing — resolved: **Run inspection** exposes persisted context and full **Resume history**.
- "prompt source" could have limited resumability — resolved: Looper stores the **Resolved prompt** for every run.
- "model" could have implied universal support — resolved: **Model override** is optional and unsupported values produce an explicit error.
- "agent compatibility" could have included approval-driven agents — resolved: standard **Looper v2** runs are **AFK-safe** and never depend on interactive permission requests.
- "agent listing" could have hidden incompatible agents — resolved: Looper lists both, with **Compatible Agents** sorted first.
- "compatibility" could have implied optional feature support — resolved: compatibility depends only on whether an **Agent** is **AFK-safe**.
- "init selection" could have allowed broken defaults — resolved: the **Init picker** only allows **Compatible Agents**.
- "non-interactive init" could have written an unusable configured `agent` — resolved: it fails for **Incompatible Agents**.
- "init validation" could have been the only guard — resolved: **Looper run** re-checks compatibility at run time.
- "agent listing" could have hidden unavailable agents — resolved: Looper still lists them and marks **Agent status** clearly.
- "agent ordering" could have been unspecified — resolved: listings sort by compatibility and availability in a fixed order.
- "run validation" could have been delayed until execution was underway — resolved: Looper performs **Preflight validation** before iteration 1.
