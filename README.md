### Description

This is a demo of "VEDAI" application that is built on top of the "DEIP" protocol which is implemented as a substrate-based chain.
"VEDAI is an investment platform that enables companies and individuals to invest into coding bootcamp Income Share Agreement (ISA) programs and receive a share of the bootcamp profits in ISA returns. This novel investment mechanism allows to align incentives for all participants of the educational market and advance the development of global human capital.

### Requirements

- docker
- docker-compose
- node.js v14+

### Launching

We will use the [Make](https://www.gnu.org/software/make/) utility to simplify execution of .sh scripts. After successful running, the application should be available at http://localhost:8080

Run the application in local environment:

```sh
make start
```

Clean local environment from application containers and data volumes
```sh
make clean
```

Restart the application in local environment and purge existing data volumes
```sh
make restart
```
