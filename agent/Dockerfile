# KMPlus Nexus Agent. Put nexus-agent.mjs (Settings → Nexus Agents → Download agent)
# next to this file, then: docker build -t nexus-agent .
FROM node:22-alpine
WORKDIR /agent
COPY nexus-agent.mjs ./
# Oracle or Snowflake connections: uncomment what you need.
# RUN npm install oracledb
# RUN npm install snowflake-sdk
USER node
ENTRYPOINT ["node", "nexus-agent.mjs", "--config", "/config/nexus-agent.json"]
