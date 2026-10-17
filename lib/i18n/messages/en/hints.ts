/** English interface text for the `hints` namespace: root-cause hints for failed runs (MN-6; id/hints.ts mirrors it). */
export const hints = {
  label: 'Likely cause',
  fixLabel: 'What to do',
  open: 'Open',
  causes: {
    agent: { title: 'The Nexus Agent is not available', fix: 'Start the agent on its server (or update it to the version the message names), then retry the run.' },
    privateNetwork: { title: 'The system is on a private network', fix: 'Nexus in the cloud can’t reach intranet addresses. Install a Nexus Agent inside that network and add the source through it.' },
    rateLimit: { title: 'The other system limited the number of requests', fix: 'Lower the requests per second (or rows per request) on the step, or raise the call limit, then retry. Nexus already waits and retries a few times.' },
    auth: { title: 'Sign-in was refused', fix: 'The password, token or key may have expired or changed. Edit the data source’s credentials and test the connection.' },
    permission: { title: 'The account lacks a permission', fix: 'Sign-in worked, but the account may not read (or write) that table or endpoint. Ask the system’s administrator to grant it, or use another account.' },
    schemaDrift: { title: 'A table or column changed in the source', fix: 'A table or column the pipeline uses was renamed or removed. Test the data source to re-scan it, then update the pipeline’s steps.' },
    dataType: { title: 'A value doesn’t fit its type', fix: 'Some values can’t be converted (e.g. text in a number or date column). Add a conversion in a Map step, or a Validate rule to hold such rows.' },
    timeout: { title: 'The system answered too slowly', fix: 'Try again later, or reduce the rows per chunk or request. For large tables, read incrementally.' },
    network: { title: 'The system could not be reached', fix: 'Check the host name, port and certificate settings of the data source, and that the system is running.' },
    remoteError: { title: 'The other system reported an error', fix: 'The problem is on the other system’s side. Nexus retried automatically; retry later or ask its administrator.' },
    held: { title: 'Rows were held back by checks', fix: 'Review the held rows in Data quality, fix or approve them, and replay them.' },
  },
}
