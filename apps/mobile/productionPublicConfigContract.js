const productionRedirectContract = require('./productionRedirectContract.json');

const productionPublicEnvironment = Object.freeze({
  EXPO_PUBLIC_BUILD_ENVIRONMENT: productionRedirectContract.productionPublic.buildEnvironment,
  EXPO_PUBLIC_APP_LINK_HOST: new URL(productionRedirectContract.universalLink.origin).hostname,
  EXPO_PUBLIC_API_BASE_URL: productionRedirectContract.universalLink.origin,
  EXPO_PUBLIC_COGNITO_DOMAIN: productionRedirectContract.productionPublic.cognitoDomain,
  EXPO_PUBLIC_COGNITO_CLIENT_ID: productionRedirectContract.productionPublic.cognitoClientId,
  EXPO_PUBLIC_COGNITO_REDIRECT_URI: productionRedirectContract.native.callbackUri,
  EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI: productionRedirectContract.native.logoutUri,
  EXPO_PUBLIC_COGNITO_SCOPES: productionRedirectContract.productionPublic.cognitoScopes.join(','),
  EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED: String(
    productionRedirectContract.productionPublic.organizationFeaturesEnabled,
  ),
});

const findProductionPublicEnvironmentMismatches = (environment) => {
  return Object.entries(productionPublicEnvironment)
    .filter(([variableName, expectedValue]) => environment[variableName] !== expectedValue)
    .map(([variableName]) => variableName);
};

module.exports = {
  findProductionPublicEnvironmentMismatches,
  productionPublicEnvironment,
  productionRedirectContract,
};
