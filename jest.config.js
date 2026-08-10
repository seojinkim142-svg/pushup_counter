module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  // Metro handles image imports at bundle time; babel-jest can't parse
  // binary PNG data, so stub them out the same way RN's jest preset does.
  moduleNameMapper: {
    '\\.(png|jpe?g|gif)$': '<rootDir>/src/lib/__tests__/__mocks__/fileMock.js',
  },
};
