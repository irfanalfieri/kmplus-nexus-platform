import type { TermsDocument } from '../terms'

/** Terms and Conditions in English. id.ts mirrors every section id. */
export const termsEn: TermsDocument = {
  title: 'Terms and Conditions',
  intro: 'These terms govern your use of KMPlus Nexus. Please read them before you continue.',
  sections: [
    {
      id: 'about',
      title: '1. About these terms',
      body: [
        'KMPlus Nexus (“**Nexus**”, “the Service”) is an integration platform provided by KMPlus (“**KMPlus**”, “we”, “us”) that connects, transforms, governs and distributes enterprise data, mainly human-resources data, for KMPlus products and other systems.',
        'By creating an account, or by selecting “I agree” when asked, you (“**you**”) accept these Terms and Conditions. If you use Nexus on behalf of a company or another organisation (“**your organisation**”), you confirm that you are authorised to do so and that these terms also bind your organisation.',
        'If your organisation has a separate signed agreement with KMPlus for Nexus (for example a master services agreement or an order form), that agreement prevails over these terms where they differ.',
      ],
    },
    {
      id: 'accounts',
      title: '2. Your account and its security',
      body: ['You are responsible for your account and everything done with it. In particular, you must:'],
      items: [
        'give accurate information when you sign up and keep it up to date;',
        'keep your password, authenticator app and backup codes to yourself; two-factor authentication is required for every account that does not sign in through your organisation’s single sign-on;',
        'not share your account or let anyone else use it;',
        'tell your workspace administrator, and KMPlus, straight away if you suspect someone else has used your account.',
      ],
    },
    {
      id: 'workspaces',
      title: '3. Workspaces, roles and administrators',
      body: [
        'Data in Nexus belongs to workspaces. A workspace’s administrators decide who is a member, what role each member has, which systems are connected and how data is governed. They can change your role or remove your access at any time.',
        'Your role decides what you can see and do. Do not try to reach data or functions your role does not allow, including masked values or rows hidden from you by row filters.',
      ],
    },
    {
      id: 'data',
      title: '4. Your data',
      body: [
        '“**Customer Data**” means the data that you or your organisation connect to, upload into or create in Nexus, including employee records and other personal data. Customer Data belongs to you or your organisation. You give KMPlus the right to host, copy, transmit and process Customer Data only as needed to provide, secure and support the Service for you, and for no other purpose.',
        'You are responsible for having the right to connect each system and to process the data you bring into Nexus, including a lawful basis under applicable law and any notices or consents your organisation needs to give its employees or other people whose data it processes.',
      ],
    },
    {
      id: 'privacy',
      title: '5. Personal data protection',
      body: [
        'For personal data in Customer Data, your organisation is the **personal data controller** and KMPlus acts as a **personal data processor** on its behalf, within the meaning of Indonesia’s Law No. 27 of 2022 on Personal Data Protection (“**UU PDP**”) and its implementing regulations. KMPlus processes that personal data only on your organisation’s documented instructions, which include the configuration your workspace makes in Nexus.',
        'KMPlus protects Customer Data with technical and organisational measures appropriate to the risk, including encryption of stored credentials, mandatory two-factor authentication, role-based access, column masking and row filters, and an audit log of changes and views of real data. KMPlus will tell your organisation without undue delay if it becomes aware of a breach affecting its personal data, so that your organisation can meet its own notification duties.',
        'Nexus provides tools your organisation can use to meet data subjects’ rights, such as retention limits and erasure of a person’s records. Personal data about you as a user (your name, email address, sign-in and audit records) is used to run, secure and support the Service.',
      ],
    },
    {
      id: 'systems',
      title: '6. Connected systems, credentials and the Nexus Agent',
      body: [
        'When you connect a system (a database, an application, an API, files, a secrets manager), you confirm that you are allowed to give Nexus that access and that you comply with that system’s own terms. Nexus encrypts stored credentials and never shows them back to the browser; you can keep them outside Nexus with a secrets manager or a Nexus Agent instead.',
        'A **Nexus Agent** is software that your organisation installs and runs inside its own network. Your organisation is responsible for the server it runs on, its configuration and the credentials kept in it. Nexus writes only to systems you add as destinations.',
      ],
    },
    {
      id: 'use',
      title: '7. Acceptable use',
      body: ['You must not, and must not help anyone else to:'],
      items: [
        'use Nexus in breach of any law, or to process data you have no right to process;',
        'access, or try to access, accounts, workspaces, systems or data without authorisation, or get around security, masking, row filters, approvals or other controls;',
        'probe, scan or test the vulnerability of the Service without KMPlus’s written permission;',
        'upload or send malware, or use Nexus to attack or overload any system;',
        'copy, modify, reverse engineer or resell the Service, except as the law expressly allows;',
        'use automated means to access the Service other than its documented Data API and webhooks, within their limits.',
      ],
    },
    {
      id: 'ai',
      title: '8. AI features',
      body: [
        'Nexus includes optional AI features (pipeline drafts, run diagnosis, connector suggestions, catalog search and questions in Analytics) that use open-source models, run by KMPlus or next to your organisation’s Nexus Agent. Prompts carry table and column names and examples from public columns only, never masked or personal values.',
        'AI output can be wrong. It is always a draft: review it before you save, publish or rely on it. Your workspace administrators can turn AI features off.',
      ],
    },
    {
      id: 'service',
      title: '9. The Service, changes and support',
      body: [
        'KMPlus works to keep Nexus available and secure, but the Service may sometimes be interrupted, for example for maintenance or because of events outside KMPlus’s control. KMPlus may improve, change or stop features; where a change materially reduces the Service your organisation uses, KMPlus will give reasonable notice.',
        'Support and any service levels are as agreed with your organisation.',
      ],
    },
    {
      id: 'fees',
      title: '10. Fees',
      body: ['Fees for Nexus, if any, are set in your organisation’s agreement with KMPlus. KMPlus will give notice before introducing fees for a feature that is currently free, such as connectors.'],
    },
    {
      id: 'confidentiality',
      title: '11. Confidentiality',
      body: ['Each party will keep the other’s confidential information confidential and use it only for the purposes of the Service. Customer Data is confidential information of your organisation. This does not apply to information that is public through no fault of the receiving party, or that must be disclosed by law, in which case the receiving party will give notice where the law allows.'],
    },
    {
      id: 'ip',
      title: '12. Intellectual property',
      body: ['KMPlus and its licensors own Nexus, including its software, design and documentation. These terms give you the right to use the Service while you have access to it; they do not transfer any ownership. If you send KMPlus feedback, KMPlus may use it without obligation to you.'],
    },
    {
      id: 'termination',
      title: '13. Suspension and termination',
      body: [
        'KMPlus may suspend or end your access if you breach these terms, if your organisation’s agreement ends, or if needed to protect the Service, other customers or Customer Data. Where reasonable, KMPlus will tell you first.',
        'You can stop using Nexus at any time. When a workspace closes, Customer Data is returned or deleted as set out in your organisation’s agreement, and otherwise after a reasonable period, except where the law requires KMPlus to keep it.',
      ],
    },
    {
      id: 'liability',
      title: '14. Disclaimers and limitation of liability',
      body: [
        'Except as expressly stated in these terms or your organisation’s agreement, the Service is provided “as is” and “as available”, and KMPlus gives no other warranties to the extent the law allows. You are responsible for checking the results of pipelines, checks and AI output before relying on them.',
        'To the extent the law allows, KMPlus is not liable for indirect or consequential losses, or for loss of profit, revenue or data caused by systems KMPlus does not control. Nothing in these terms limits liability that cannot be limited by law.',
      ],
    },
    {
      id: 'changes',
      title: '15. Changes to these terms',
      body: ['KMPlus may update these terms. Each version has an effective date. When a new version is published, Nexus asks you to accept it before you continue; if you do not accept it, you can sign out and stop using the Service. The version you accepted and when are recorded with your account.'],
    },
    {
      id: 'law',
      title: '16. Governing law, disputes and language',
      body: [
        'These terms are governed by the laws of the Republic of Indonesia. The parties will first try to settle any dispute amicably through good-faith discussion; if it is not settled within thirty (30) days, it will be resolved by the competent courts of the Republic of Indonesia, unless your organisation’s agreement with KMPlus says otherwise.',
        'These terms are made in English and Bahasa Indonesia. If the two versions differ, the Bahasa Indonesia version prevails.',
      ],
    },
    {
      id: 'contact',
      title: '17. Contact',
      body: ['Questions about these terms or about your data in Nexus: contact your workspace administrator, or KMPlus through your organisation’s KMPlus account contact.'],
    },
  ],
}
