import { defineFacts, fact } from "pagegraph";

export const facts = defineFacts({ emails: fact.number(3000), runtime: fact.text("workerd") });
