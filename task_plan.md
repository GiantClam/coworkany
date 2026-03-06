# Task Plan: RAG first-use predownload + persistent cache

## Goal
Implement first-use flow so RAG model downloads only once after proxy is configured, with persistent cache and readiness marker.

## Phases
- [completed] Locate current settings/setup + RAG startup path
- [completed] Add backend support: persistent model cache path + predownload status and command
- [completed] Add frontend setup/settings integration to trigger predownload after proxy setup
- [completed] Validate with build/tests and log results

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| `AppHandle.path()` method not found in process_manager | 1 | Imported `tauri::Manager` trait and re-ran checks |

