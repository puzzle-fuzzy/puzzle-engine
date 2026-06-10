# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- Fixed `dev:server` and `dev:client` scripts to target specific workspaces (`apps/server`, `apps/client`) instead of recursive calls
- Fixed `concurrently` command: added `--prefix-colors` flag for color config, moved `--kill-others-on-fail` to end