FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY web ./web
RUN cargo build --release

FROM debian:stable-slim
COPY --from=build /src/target/release/scrawl /usr/local/bin/scrawl
# The port comes from $PORT when the host sets it (Render, Railway, Fly), otherwise 7878.
ENV SCRAWL_DATA=/data
VOLUME /data
EXPOSE 7878
CMD ["scrawl"]
