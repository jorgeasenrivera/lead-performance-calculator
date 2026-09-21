/* A manager looking at the dashboard does not need the TV's whole document.
   Share an in-flight download, but forget a failed one so the TV can retry. */
export function createBoardRenderer(loadTemplate = () => import("./leaderboard-template.mjs")) {
  let template;
  return async (payload, pix) => {
    if (!template) {
      template = Promise.resolve().then(loadTemplate).catch((error) => {
        template = undefined;
        throw error;
      });
    }
    const { LEADERBOARD_HTML } = await template;
    return LEADERBOARD_HTML(payload, pix);
  };
}

export const renderLeaderboard = createBoardRenderer();
