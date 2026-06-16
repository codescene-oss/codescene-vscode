function isAceBuildEnabled(): boolean {
  return process.env.BUILD_NO_ACE !== 'true';
}

export function aceSuite(title: string, fn: (this: Mocha.Suite) => void) {
  return (isAceBuildEnabled() ? suite : suite.skip)(title, fn);
}

export function aceTest(title: string, fn: Mocha.Func) {
  return (isAceBuildEnabled() ? test : test.skip)(title, fn);
}

export function noAceSuite(title: string, fn: (this: Mocha.Suite) => void) {
  return (process.env.BUILD_NO_ACE === 'true' ? suite : suite.skip)(title, fn);
}
