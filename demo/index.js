import React, { Component, Fragment } from "react";
import { render } from "react-dom";
import { Client, setDefaultClient, useQuery, buildQuery } from "../src/index";

import { Books } from "./use-case-1/books";
import { Subjects } from "./use-case-1/subjects";

import { BooksEdit } from "./shared/books-edit";

import { BOOKS_QUERY, SUBJECTS_QUERY } from "./savedQueries";

const client = new Client({
  endpoint: "/graphql",
  fetchOptions: { credentials: "include" }
});

setDefaultClient(client);

const Home = props => {
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        <div>
          <Books />
          <Subjects />
        </div>
        <div style={{ marginLeft: "40px" }}>
          <BooksEdit />
          <Subjects />
        </div>
      </div>
    </div>
  );
};

render(<Home />, document.getElementById("home1"));
