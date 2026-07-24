const loadApp = (): React.ComponentType => {
  if (process.env.EXPO_PUBLIC_MOBILE_SMOKE_TEST === '1') {
    return require('./src/SmokeApp').default as React.ComponentType;
  }

  return require('./src/App').default as React.ComponentType;
};

const App = loadApp();

export default App;
