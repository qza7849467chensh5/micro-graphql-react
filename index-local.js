import Client, { defaultClientManager } from "./src/client";
import query from "./src/query";
import mutation from "./src/mutation";
import compress from "./src/compress";

const { setDefaultClient } = defaultClientManager;
export { Client, query, compress, mutation, setDefaultClient };
