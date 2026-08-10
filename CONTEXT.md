# Amari Automation

The Amari Automation context owns workflow definitions, their published versions, enrollments, and execution evidence.

## Language

**Canonical Workflow**:
The complete workflow object that is both executed by the automation engine and rendered by Staff.
_Avoid_: Map, registry copy, workflow preview

**Workflow Version**:
An immutable revision of a Canonical Workflow. Each enrollment remains attached to the version it entered.
_Avoid_: Deployment, latest copy

**Published Version**:
The one Workflow Version currently accepting new enrollments.
_Avoid_: Live label, active-looking version

**Draft Version**:
An editable Workflow Version that cannot accept enrollments or send messages.
_Avoid_: Unpublished live workflow

**Enrollment**:
One person and triggering record progressing through one immutable Workflow Version.
_Avoid_: Contact in workflow, run

**Execution Evidence**:
Append-only facts produced while an Enrollment advances, sends, exits, fails, or is cancelled.
_Avoid_: History approximation, inferred activity

**Operator View**:
The Staff interface that renders the Canonical Workflow, its Published Version, Enrollments, and Execution Evidence.
_Avoid_: Workflow representation, evidence map
