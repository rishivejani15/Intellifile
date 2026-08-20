module.exports = async function() {
  // Custom sign hook for electron-builder to bypass winCodeSign while keeping rcedit icon replacement enabled
  return true;
};
