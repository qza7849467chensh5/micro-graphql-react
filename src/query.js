import React, { Component } from "react";
import { defaultClientManager } from "./client";

const setPendingResultSymbol = Symbol("setPendingResult");
const setResultsSymbol = Symbol("setResults");
const getFromCacheSymbol = Symbol("getFromCache");
const noCachingSymbol = Symbol("noCaching");
const cacheSymbol = Symbol("cache");
class QueryCache {
  constructor(cacheSize = 0) {
    this.cacheSize = cacheSize;
  }
  [cacheSymbol] = new Map([]);
  get [noCachingSymbol]() {
    return !this.cacheSize;
  }

  get entries() {
    return [...this[cacheSymbol]];
  }

  get(key) {
    return this[cacheSymbol].get(key);
  }

  set(key, results) {
    this[cacheSymbol].set(key, results);
  }

  delete(key) {
    this[cacheSymbol].delete(key);
  }

  clearCache() {
    this[cacheSymbol].clear();
  }

  [setPendingResultSymbol](graphqlQuery, promise) {
    let cache = this[cacheSymbol];
    //front of the line now, to support LRU ejection
    if (!this[noCachingSymbol]) {
      cache.delete(graphqlQuery);
      if (cache.size === this.cacheSize) {
        //maps iterate entries and keys in insertion order - zero'th key should be oldest
        cache.delete([...cache.keys()][0]);
      }
      cache.set(graphqlQuery, promise);
    }
  }

  [setResultsSymbol](promise, cacheKey, resp, err) {
    let cache = this[cacheSymbol];
    if (this[noCachingSymbol]) {
      return;
    }

    //cache may have been cleared while we were running. If so, we'll respect that, and not touch the cache, but
    //we'll still use the results locally
    if (cache.get(cacheKey) !== promise) return;

    if (err) {
      cache.set(cacheKey, { data: null, error: err });
    } else {
      if (resp.errors) {
        cache.set(cacheKey, { data: null, error: errors });
      } else {
        cache.set(cacheKey, { data: resp.data, error: null });
      }
    }
  }

  [getFromCacheSymbol](key, ifPending, ifResults, ifNotFound) {
    let cache = this[cacheSymbol];
    if (this[noCachingSymbol]) {
      ifNotFound();
    } else {
      let cachedEntry = cache.get(key);
      if (cachedEntry) {
        if (typeof cachedEntry.then === "function") {
          ifPending(cachedEntry);
        } else {
          //re-insert to put it at the fornt of the line
          cache.delete(key);
          this.set(key, cachedEntry);
          ifResults(cachedEntry);
        }
      } else {
        ifNotFound();
      }
    }
  }
}

const DEFAULT_CACHE_SIZE = 10;

export default (query, variablesFn, packet = {}) => BaseComponent => {
  const { shouldQueryUpdate, mapProps = props => props, client: clientOption, onMutation } = packet;
  const client = clientOption || defaultClientManager.getDefaultClient();
  const cache = client.getCache(query) || client.setCache(query, new QueryCache(DEFAULT_CACHE_SIZE));

  if (typeof variablesFn === "object") {
    packet = variablesFn;
    variablesFn = null;
  }

  if (!client) {
    throw "[micro-graphql-error]: No client is configured. See the docs for info on how to do this.";
  }

  const queryFn = props => {
    return {
      query,
      variables: variablesFn ? variablesFn(props) : null
    };
  };

  return class extends Component {
    state = { loading: false, loaded: false, data: null, error: null };
    currentGraphqlQuery = null;
    currentQuery = null;
    currentVariables = null;

    softReset = newResults => {
      cache.clearCache();
      this.setState({ data: newResults });
    };

    hardReset = () => {
      cache.clearCache();
      this.reloadCurrentQuery();
    };

    reloadCurrentQuery = () => {
      let queryPacket = queryFn(this.props);
      this.execute(queryPacket);
    };

    componentDidMount() {
      let queryPacket = queryFn(this.props);
      this.loadQuery(queryPacket);
      if (onMutation) {
        this.__mutationSubscription = client.subscribeMutation(onMutation, {
          cache,
          softReset: this.softReset,
          hardReset: this.hardReset,
          currentResults: () => this.state.data
        });
      }
    }
    componentDidUpdate(prevProps, prevState) {
      let queryPacket = queryFn(this.props);
      let graphqlQuery = client.getGraphqlQuery(queryPacket);
      if (this.isDirty(queryPacket)) {
        if (shouldQueryUpdate) {
          if (
            shouldQueryUpdate({
              prevProps,
              props: this.props,
              prevQuery: this.currentGraphqlQuery,
              query: graphqlQuery,
              prevVariables: this.currentVariables,
              variables: queryPacket.variables
            })
          ) {
            this.loadQuery(queryPacket);
          }
        } else {
          this.loadQuery(queryPacket);
        }
      }
    }

    componentWillUnmount() {
      this.__mutationSubscription && this.__mutationSubscription();
    }

    isDirty(queryPacket) {
      let graphqlQuery = client.getGraphqlQuery(queryPacket);
      return graphqlQuery !== this.currentGraphqlQuery;
    }

    loadQuery(queryPacket) {
      let graphqlQuery = client.getGraphqlQuery(queryPacket);
      this.currentGraphqlQuery = graphqlQuery;
      this.currentQuery = queryPacket.query;
      this.currentVariables = queryPacket.variables;

      cache[getFromCacheSymbol](
        graphqlQuery,
        promise => {
          Promise.resolve(promise).then(() => {
            //cache should now be updated, unless it was cleared. Either way, re-run this method
            this.loadQuery(queryPacket);
          });
        },
        cachedEntry => {
          this.setCurrentState(cachedEntry.data, cachedEntry.error);
        },
        () => this.execute(queryPacket)
      );
    }

    execute({ query, variables }) {
      if (!this.state.loading || this.state.loaded) {
        this.setState({
          loading: true,
          loaded: false
        });
      }
      let graphqlQuery = client.getGraphqlQuery({ query, variables });
      let promise = client.runQuery(query, variables);
      cache[setPendingResultSymbol](graphqlQuery, promise);
      this.handleExecution(promise, graphqlQuery);
    }

    handleExecution = (promise, cacheKey) => {
      Promise.resolve(promise)
        .then(resp => {
          cache[setResultsSymbol](promise, cacheKey, resp);
          if (resp.errors) {
            this.handlerError(resp.errors);
          } else {
            this.setCurrentState(resp.data, null);
          }
        })
        .catch(err => {
          cache[setResultsSymbol](promise, cacheKey, null, err);
          this.handlerError(err);
        });
    };

    handlerError = err => {
      this.setCurrentState(null, err);
    };

    setCurrentState = (data, error) => {
      this.setState({
        loading: false,
        loaded: true,
        data,
        error
      });
    };

    executeNow = () => {
      let queryPacket = queryFn(this.props);
      this.execute(queryPacket);
    };

    clearCacheAndReload = () => {
      cache.clearCache();
      this.executeNow();
    };

    render() {
      let { loading, loaded, data, error } = this.state;
      let packet = mapProps({
        loading,
        loaded,
        data,
        error,
        reload: this.executeNow,
        clearCache: () => cache.clearCache(),
        clearCacheAndReload: this.clearCacheAndReload
      });

      return <BaseComponent {...packet} {...this.props} />;
    }
  };
};
