FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && rm -r ~/.npm

COPY --chown=myuser:myuser . ./

# Node sizes its heap from the machine, not the run's memory limit, so without a cap it grows past the container's
# limit and the run is killed (exit 137) before garbage collection kicks in. 65% leaves room for buffers and parsing.
CMD ["sh", "-c", "exec node --max-old-space-size=$(( ${ACTOR_MEMORY_MBYTES:-1024} * 65 / 100 )) src/main.js"]
