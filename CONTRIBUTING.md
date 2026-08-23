# Contributing

## Before opening a pull request

1. Open an issue for security-sensitive or behaviorally breaking changes.
2. Use Node.js 24 and pnpm 11.
3. Run `pnpm check`.
4. Add tests for behavior changes.
5. Add new golden-vector files for evaluation changes; existing vectors are immutable.

Pull requests must not contain credentials, customer data, production SDK keys, private platform
code, or generated build output. All contributions are provided under the MIT License.
