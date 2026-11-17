FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
COPY web ./web
RUN cargo build --release

FROM debian:stable-slim
COPY --from=build /src/target/release/scrawl /usr/local/bin/scrawl
ENV SCRAWL_DATA=/data SCRAWL_ADDR=0.0.0.0:8080
VOLUME /data
EXPOSE 8080
CMD ["scrawl"]
