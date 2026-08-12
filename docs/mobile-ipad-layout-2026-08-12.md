# Mobile iPad layout correction

## Purpose and scope

Apple rejected iOS version 1.0 build 30 under Guideline 4 after running the
iPhone-only binary on an iPad Air 11-inch (M3). The correction makes the Mobile
client a first-class iPad app and keeps every primary screen readable in full
screen, landscape, and resizable iPad windows. It does not change API, billing,
credit, persistence, or generation behavior.

## Spec basis and affected layers

The closest current contract is `docs/Lyra_Unified_Spec_v4.md` section 2
(authenticated production flows) and section 10 (release verification). The
change is limited to Mobile UI and iOS build metadata:

- enable the iPad device family without opting out of multitasking;
- constrain shared screen content to a centered readable width;
- apply all safe-area edges;
- use the same width contract for the authentication splash and bottom tabs.

## Interfaces and security

There are no new network inputs, outputs, stored values, external APIs, or
permissions. Authentication, authorization, StoreKit verification, credit
granting, image handling, and secrets are unchanged.

## Test and release plan

Tests first lock the iPad metadata, shared content frame, safe-area edges, and
tab width. After observing the expected failures, implement the shared layout,
then run the focused tests, all Mobile tests, typecheck, lint, contract and
mojibake checks, and an iOS export. The release artifact must have a new build
number, `UIDeviceFamily` values 1 and 2, four iPad orientations, and a valid
App Store Connect processing state before resubmission.

## Terra delegation

Terra performs read-only layout and metadata inspection only. Sol owns the
design, implementation, integration review, release build, and Apple
resubmission.
